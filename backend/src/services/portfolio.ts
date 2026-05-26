import { 
  Portfolio, 
  Position, 
  Pool, 
  YieldMode, 
  PortfolioSettings,
  PerformanceMetrics,
  Allocation,
  RebalanceAction,
  RebalancePlan,
} from '../../../shared/types/index.js';
import { logger, logTrade, logRebalance } from '../utils/logger.js';
import { defiLlamaService } from './defillama.js';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { asDate, asTimeMs } from '../utils/dates.js';

const DATA_DIR = './data';

interface PaperTrade {
  id: string;
  timestamp: Date;
  type: 'ENTER' | 'EXIT';
  poolId: string;
  amount: number;
  fees: number;
  apyAtEntry: number;
}

interface PortfolioSnapshot {
  timestamp: Date;
  totalValue: number;
  positions: Position[];
  metrics: PerformanceMetrics;
}

export class PortfolioService {
  private portfolios: Map<string, Portfolio> = new Map();
  private positions: Map<string, Position> = new Map();
  private trades: Map<string, PaperTrade[]> = new Map();
  private snapshots: Map<string, PortfolioSnapshot[]> = new Map();

  constructor() {
    this.initializeDataDir().then(() => {
      this.loadFromDisk();
    });
  }

  private async initializeDataDir(): Promise<void> {
    try {
      await mkdir(DATA_DIR, { recursive: true });
    } catch (error) {
      logger.error('Failed to create data directory', error as Error);
    }
  }

  private async loadFromDisk(): Promise<void> {
    try {
      // Load portfolios
      try {
        const portfoliosData = await readFile(join(DATA_DIR, 'portfolios.json'), 'utf-8');
        const portfoliosObj = JSON.parse(portfoliosData);
        for (const [id, portfolio] of Object.entries(portfoliosObj) as [string, Portfolio][]) {
          this.portfolios.set(id, portfolio);
          this.syncPortfolioTotals(portfolio);
        }
      } catch (error) {
        // File doesn't exist yet, that's ok
      }

      // Load positions
      try {
        const positionsData = await readFile(join(DATA_DIR, 'positions.json'), 'utf-8');
        const positionsObj = JSON.parse(positionsData);
        for (const [id, position] of Object.entries(positionsObj) as [string, Position][]) {
          position.entryTimestamp = asDate(position.entryTimestamp);
          if (position.exitTimestamp) {
            position.exitTimestamp = asDate(position.exitTimestamp);
          }
          this.positions.set(id, position);
        }
      } catch (error) {
        // File doesn't exist yet, that's ok
      }

      // Load trades
      try {
        const tradesData = await readFile(join(DATA_DIR, 'trades.json'), 'utf-8');
        const tradesObj = JSON.parse(tradesData);
        for (const [id, trades] of Object.entries(tradesObj)) {
          this.trades.set(id, (trades as PaperTrade[]).map(t => ({
            ...t,
            timestamp: asDate(t.timestamp),
          })));
        }
      } catch (error) {
        // File doesn't exist yet, that's ok
      }

      // Load snapshots
      try {
        const snapshotsData = await readFile(join(DATA_DIR, 'snapshots.json'), 'utf-8');
        const snapshotsObj = JSON.parse(snapshotsData);
        for (const [id, snapshots] of Object.entries(snapshotsObj)) {
          this.snapshots.set(id, (snapshots as PortfolioSnapshot[]).map(s => ({
            ...s,
            timestamp: asDate(s.timestamp),
            positions: s.positions.map(p => ({
              ...p,
              entryTimestamp: asDate(p.entryTimestamp),
              exitTimestamp: p.exitTimestamp ? asDate(p.exitTimestamp) : undefined,
            })),
          })));
        }
      } catch (error) {
        // File doesn't exist yet, that's ok
      }

      logger.info('Loaded portfolio data from disk', {
        portfolios: this.portfolios.size,
        positions: this.positions.size,
      });
    } catch (error) {
      logger.error('Failed to load data from disk', error as Error);
    }
  }

  private async saveToDisk(): Promise<void> {
    try {
      const portfoliosObj = Object.fromEntries(this.portfolios);
      const positionsObj = Object.fromEntries(this.positions);
      const tradesObj = Object.fromEntries(this.trades);
      const snapshotsObj = Object.fromEntries(this.snapshots);

      await Promise.all([
        writeFile(join(DATA_DIR, 'portfolios.json'), JSON.stringify(portfoliosObj, null, 2)),
        writeFile(join(DATA_DIR, 'positions.json'), JSON.stringify(positionsObj, null, 2)),
        writeFile(join(DATA_DIR, 'trades.json'), JSON.stringify(tradesObj, null, 2)),
        writeFile(join(DATA_DIR, 'snapshots.json'), JSON.stringify(snapshotsObj, null, 2)),
      ]);

      logger.debug('Saved portfolio data to disk');
    } catch (error) {
      logger.error('Failed to save data to disk', error as Error);
    }
  }

  /** After JSON load (or before metrics): normalize dates and recompute totalValue from cash + positions. */
  private syncPortfolioTotals(portfolio: Portfolio): void {
    portfolio.createdAt = asDate(portfolio.createdAt);
    portfolio.updatedAt = asDate(portfolio.updatedAt);
    for (const position of portfolio.positions) {
      position.entryTimestamp = asDate(position.entryTimestamp);
      if (position.exitTimestamp) {
        position.exitTimestamp = asDate(position.exitTimestamp);
      }
      if (position.pool?.lastUpdated) {
        position.pool.lastUpdated = asDate(position.pool.lastUpdated as unknown as Date);
      }
    }
    portfolio.totalValue = portfolio.availableCash + this.calculatePositionsValue(portfolio);

    const exp = this.computeExpectedPositionMetrics(portfolio);
    portfolio.performanceMetrics = {
      ...this.initializeMetrics(),
      ...portfolio.performanceMetrics,
      expectedApy: exp.expectedApy,
      expectedVolatility: exp.expectedVolatility,
      expectedSortinoRatio: exp.expectedSortinoRatio,
    };
  }

  /**
   * Forward-looking metrics from active positions: value-weighted current APY, pool volatility scores,
   * and Sortino (weighted pool ratio when present, else APY/vol).
   */
  private computeExpectedPositionMetrics(portfolio: Portfolio): {
    expectedApy: number;
    expectedVolatility: number;
    expectedSortinoRatio: number;
  } {
    const active = portfolio.positions.filter((p) => p.status === 'ACTIVE');
    let deployed = 0;
    for (const p of active) {
      deployed += p.amount + p.unrealizedPnl;
    }
    if (deployed <= 0 || active.length === 0) {
      return { expectedApy: 0, expectedVolatility: 0, expectedSortinoRatio: 0 };
    }

    let sumWApy = 0;
    let sumWVol = 0;
    let sumWSort = 0;
    let sortDenom = 0;

    for (const p of active) {
      const w = (p.amount + p.unrealizedPnl) / deployed;
      const apy = Number(p.currentApy ?? p.pool?.apy ?? 0);
      const pool = p.pool;
      const volRaw = pool.volatilityScore;
      const vol =
        volRaw !== undefined && Number.isFinite(volRaw) && volRaw >= 0
          ? Math.min(volRaw, 100)
          : pool.stablecoin
            ? 10
            : Math.min(55, 12 + Math.abs(apy) * 0.4);

      const ps = pool.sortinoRatio;
      sumWApy += w * apy;
      sumWVol += w * vol;
      if (ps !== undefined && ps > 0 && Number.isFinite(ps)) {
        sumWSort += w * ps;
        sortDenom += w;
      }
    }

    const expectedApy = sumWApy;
    const expectedVolatility = sumWVol;
    const expectedSortinoRatio =
      sortDenom > 0.01
        ? sumWSort / sortDenom
        : expectedVolatility > 0.05
          ? expectedApy / expectedVolatility
          : 0;

    return {
      expectedApy: Number.isFinite(expectedApy) ? expectedApy : 0,
      expectedVolatility: Number.isFinite(expectedVolatility) ? expectedVolatility : 0,
      expectedSortinoRatio: Number.isFinite(expectedSortinoRatio) ? expectedSortinoRatio : 0,
    };
  }

  // Create a new paper trading portfolio
  async createPortfolio(
    name: string,
    settings: PortfolioSettings
  ): Promise<Portfolio> {
    const id = `portfolio-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const portfolio: Portfolio = {
      id,
      mode: settings.mode,
      totalValue: settings.initialCapital,
      availableCash: settings.initialCapital,
      positions: [],
      targetAllocation: [],
      actualAllocation: [],
      performanceMetrics: this.initializeMetrics(),
      createdAt: new Date(),
      updatedAt: new Date(),
      settings,
    };

    this.portfolios.set(id, portfolio);
    this.trades.set(id, []);
    this.snapshots.set(id, []);

    await this.saveToDisk();

    logger.info('Portfolio created', { 
      portfolioId: id, 
      mode: settings.mode, 
      initialCapital: settings.initialCapital,
      paperTrading: settings.paperTrading,
    });

    return portfolio;
  }

  // Get portfolio by ID
  getPortfolio(id: string): Portfolio | undefined {
    const p = this.portfolios.get(id);
    if (p) this.syncPortfolioTotals(p);
    return p;
  }

  // Get all portfolios
  getAllPortfolios(): Portfolio[] {
    const list = Array.from(this.portfolios.values());
    for (const p of list) {
      this.syncPortfolioTotals(p);
    }
    return list;
  }

  // Enter a position (paper trade)
  async enterPosition(
    portfolioId: string,
    pool: Pool,
    amount: number,
    fees: number
  ): Promise<Position> {
    const portfolio = this.portfolios.get(portfolioId);
    if (!portfolio) {
      throw new Error(`Portfolio ${portfolioId} not found`);
    }

    if (portfolio.availableCash < amount + fees) {
      throw new Error('Insufficient funds for position entry');
    }

    const positionId = `pos-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const position: Position = {
      id: positionId,
      poolId: pool.id,
      pool,
      amount,
      tokenAmounts: { [pool.symbol]: amount }, // Simplified
      entryApy: pool.apy,
      currentApy: pool.apy,
      entryTimestamp: new Date(),
      unrealizedPnl: 0,
      realizedPnl: 0,
      feesPaid: fees,
      status: 'ACTIVE',
    };

    // Update portfolio
    portfolio.positions.push(position);
    portfolio.availableCash -= (amount + fees);
    portfolio.totalValue = portfolio.availableCash + this.calculatePositionsValue(portfolio);
    portfolio.updatedAt = new Date();

    // Record trade
    const trade: PaperTrade = {
      id: `trade-${Date.now()}`,
      timestamp: new Date(),
      type: 'ENTER',
      poolId: pool.id,
      amount,
      fees,
      apyAtEntry: pool.apy,
    };
    this.trades.get(portfolioId)?.push(trade);

    this.positions.set(positionId, position);
    logTrade('ENTER', pool.id, amount, fees);

    await this.saveToDisk();

    return position;
  }

  // Exit a position (paper trade)
  async exitPosition(
    portfolioId: string,
    positionId: string,
    reason?: string
  ): Promise<Position> {
    const portfolio = this.portfolios.get(portfolioId);
    if (!portfolio) {
      throw new Error(`Portfolio ${portfolioId} not found`);
    }

    const positionIndex = portfolio.positions.findIndex(p => p.id === positionId);
    if (positionIndex === -1) {
      throw new Error(`Position ${positionId} not found`);
    }

    const position = portfolio.positions[positionIndex];
    
    // Calculate exit fees
    const exitFees = position.amount * 0.001; // 0.1% exit fee estimate

    // Calculate realized PnL (simplified - assumes immediate compounding)
    const holdingPeriod = (Date.now() - asTimeMs(position.entryTimestamp)) / (1000 * 60 * 60 * 24); // days
    const yieldEarned = position.amount * (position.currentApy / 100) * (holdingPeriod / 365);
    position.realizedPnl = yieldEarned - position.feesPaid - exitFees;
    position.unrealizedPnl = 0;

    // Update portfolio
    portfolio.availableCash += position.amount + yieldEarned - exitFees;
    portfolio.positions.splice(positionIndex, 1);
    portfolio.totalValue = portfolio.availableCash + this.calculatePositionsValue(portfolio);
    
    // Update position
    position.status = 'CLOSED';
    position.exitTimestamp = new Date();
    position.exitReason = reason || 'Manual exit';
    position.feesPaid += exitFees;

    portfolio.updatedAt = new Date();

    // Record trade
    const trade: PaperTrade = {
      id: `trade-${Date.now()}`,
      timestamp: new Date(),
      type: 'EXIT',
      poolId: position.poolId,
      amount: position.amount,
      fees: exitFees,
      apyAtEntry: position.entryApy,
    };
    this.trades.get(portfolioId)?.push(trade);

    logTrade('EXIT', position.poolId, position.amount, exitFees);

    await this.saveToDisk();

    return position;
  }

  // Update all positions with current APYs and calculate PnL
  async updatePositions(portfolioId: string): Promise<void> {
    const portfolio = this.portfolios.get(portfolioId);
    if (!portfolio) return;

    for (const position of portfolio.positions) {
      if (position.status !== 'ACTIVE') continue;

      // Fetch current pool data
      const currentPool = await defiLlamaService.getPool(position.poolId, position.pool);
      if (!currentPool) {
        logger.warn('Could not fetch current pool data', { poolId: position.poolId });
        continue;
      }

      // Update position
      position.currentApy = currentPool.apy;
      position.pool = currentPool; // Update pool data

      // Calculate unrealized PnL
      const holdingPeriod = (Date.now() - asTimeMs(position.entryTimestamp)) / (1000 * 60 * 60 * 24); // days
      const yieldEarned = position.amount * (position.currentApy / 100) * (holdingPeriod / 365);
      position.unrealizedPnl = yieldEarned - position.feesPaid;
    }

    // Recalculate total value
    portfolio.totalValue = portfolio.availableCash + this.calculatePositionsValue(portfolio);
    portfolio.updatedAt = new Date();

    // Update performance metrics
    portfolio.performanceMetrics = this.calculateMetrics(portfolio);

    // Save snapshot
    await this.saveSnapshot(portfolio);
  }

  // Execute a rebalance plan
  async executeRebalance(
    portfolioId: string,
    plan: RebalancePlan
  ): Promise<void> {
    const portfolio = this.portfolios.get(portfolioId);
    if (!portfolio) {
      throw new Error(`Portfolio ${portfolioId} not found`);
    }

    logger.info('Executing rebalance plan', { 
      portfolioId, 
      planId: plan.id, 
      actionCount: plan.actions.length,
    });

    for (const action of plan.actions) {
      try {
        switch (action.type) {
          case 'EXIT': {
            const position = portfolio.positions.find(p => p.poolId === action.poolId);
            if (position) {
              await this.exitPosition(portfolioId, position.id, action.reason);
            }
            break;
          }
          
          case 'ENTER': {
            if (!action.targetAmount || action.targetAmount <= 0) continue;
            
            const pool = await defiLlamaService.getPool(action.poolId);
            if (!pool) {
              logger.warn('Pool not found for entry', { poolId: action.poolId });
              continue;
            }
            
            // Estimate fees (minimum 0.2%)
            const fees = Math.max(
              action.expectedFees,
              action.targetAmount * 0.002
            );
            
            // Check if we have sufficient funds
            const totalRequired = action.targetAmount + fees;
            if (portfolio.availableCash < totalRequired) {
              // Scale down to available cash minus fee buffer
              const scaledAmount = portfolio.availableCash * 0.998;
              if (scaledAmount < 100) {
                logger.warn('Insufficient funds for entry, skipping', { 
                  poolId: action.poolId,
                  available: portfolio.availableCash,
                  required: totalRequired,
                });
                continue;
              }
              
              logger.info('Scaling down entry due to insufficient funds', {
                poolId: action.poolId,
                requested: action.targetAmount,
                actual: scaledAmount,
                available: portfolio.availableCash,
              });
              
              await this.enterPosition(portfolioId, pool, scaledAmount, scaledAmount * 0.002);
            } else {
              await this.enterPosition(portfolioId, pool, action.targetAmount, fees);
            }
            break;
          }
          
          case 'REALLOCATE': {
            if (!action.delta) continue;
            
            // First exit part/all of position
            const position = portfolio.positions.find(p => p.poolId === action.poolId);
            if (position && action.delta < 0) {
              const exitAmount = Math.abs(action.delta);
              // Simplified - would need partial exit logic
              if (exitAmount >= position.amount * 0.95) {
                await this.exitPosition(portfolioId, position.id, action.reason);
              }
            } else if (action.delta > 0 && position) {
              // Add to existing position
              const pool = await defiLlamaService.getPool(action.poolId);
              if (pool) {
                const fees = action.delta * 0.002;
                await this.enterPosition(portfolioId, pool, action.delta, fees);
              }
            }
            break;
          }
          
          case 'HOLD':
          default:
            // No action needed
            break;
        }
        
        logRebalance(plan.id, action.type, {
          poolId: action.poolId,
          amount: action.delta,
          reason: action.reason,
        });
      } catch (error) {
        logger.error('Failed to execute rebalance action', error as Error, {
          portfolioId,
          planId: plan.id,
          action,
        });
      }
    }

    // Update allocations
    await this.updatePositions(portfolioId);
    portfolio.targetAllocation = plan.actions
      .filter(a => a.type === 'ENTER' || a.type === 'REALLOCATE')
      .map(a => ({
        poolId: a.poolId,
        targetPercentage: a.targetAmount ? (a.targetAmount / portfolio.totalValue) * 100 : 0,
        actualPercentage: 0,
        currentValue: 0,
        deviation: 0,
      }));

    portfolio.actualAllocation = this.calculateActualAllocation(portfolio);

    await this.saveToDisk();
  }

  // Get performance history
  getPerformanceHistory(portfolioId: string, days: number = 30): PortfolioSnapshot[] {
    const snapshots = this.snapshots.get(portfolioId) || [];
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return snapshots.filter(s => asTimeMs(s.timestamp) > cutoff);
  }

  // Get trades history
  getTrades(portfolioId: string): PaperTrade[] {
    return this.trades.get(portfolioId) || [];
  }

  // Get portfolio statistics
  getPortfolioStats(portfolioId: string): {
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    averageHoldingPeriod: number;
    totalFees: number;
    totalYield: number;
  } {
    const trades = this.trades.get(portfolioId) || [];
    const portfolio = this.portfolios.get(portfolioId);
    
    const entries = trades.filter(t => t.type === 'ENTER');
    const exits = trades.filter(t => t.type === 'EXIT');
    
    let totalYield = 0;
    let winningTrades = 0;
    let losingTrades = 0;
    let totalHoldingHours = 0;

    for (const exit of exits) {
      const exitTs = asTimeMs(exit.timestamp);
      const entry = entries.find(
        e => e.poolId === exit.poolId && asTimeMs(e.timestamp) < exitTs
      );
      if (entry) {
        const holdingHours = (exitTs - asTimeMs(entry.timestamp)) / (1000 * 60 * 60);
        totalHoldingHours += holdingHours;
        
        const yieldEarned = (exit.amount * (exit.apyAtEntry / 100) * (holdingHours / (24 * 365))) - exit.fees;
        totalYield += yieldEarned;
        
        if (yieldEarned > 0) winningTrades++;
        else losingTrades++;
      }
    }

    return {
      totalTrades: trades.length,
      winningTrades,
      losingTrades,
      averageHoldingPeriod: exits.length > 0 ? totalHoldingHours / exits.length : 0,
      totalFees: trades.reduce((sum, t) => sum + t.fees, 0),
      totalYield,
    };
  }

  // Private helper methods
  private calculatePositionsValue(portfolio: Portfolio): number {
    return portfolio.positions
      .filter(p => p.status === 'ACTIVE')
      .reduce((sum, p) => sum + p.amount + p.unrealizedPnl, 0);
  }

  private calculateActualAllocation(portfolio: Portfolio): Allocation[] {
    const totalValue = portfolio.totalValue;
    if (totalValue === 0) return [];

    return portfolio.positions
      .filter(p => p.status === 'ACTIVE')
      .map(p => {
        const currentValue = p.amount + p.unrealizedPnl;
        const percentage = (currentValue / totalValue) * 100;
        const target = portfolio.targetAllocation.find(t => t.poolId === p.poolId);
        
        return {
          poolId: p.poolId,
          targetPercentage: target?.targetPercentage || 0,
          actualPercentage: percentage,
          currentValue,
          deviation: percentage - (target?.targetPercentage || 0),
        };
      });
  }

  private calculateMetrics(portfolio: Portfolio): PerformanceMetrics {
    const history = this.snapshots.get(portfolio.id) || [];
    const stats = this.getPortfolioStats(portfolio.id);

    // Calculate returns (guard against missing/zero initial capital)
    const initialValue = Math.max(portfolio.settings?.initialCapital ?? 0, 1e-9);
    const currentValue = portfolio.totalValue;
    const totalReturn =
      initialValue > 0 ? ((currentValue - initialValue) / initialValue) * 100 : 0;

    // Calculate daily return from snapshots
    let dailyReturn = 0;
    let weeklyReturn = 0;
    let monthlyReturn = 0;

    if (history.length >= 2) {
      const latest = history[history.length - 1];
      const latestTs = asTimeMs(latest.timestamp);
      const yesterday = history.find(s => 
        asTimeMs(s.timestamp) >= latestTs - 24 * 60 * 60 * 1000
      );
      const lastWeek = history.find(s => 
        asTimeMs(s.timestamp) >= latestTs - 7 * 24 * 60 * 60 * 1000
      );
      const lastMonth = history.find(s => 
        asTimeMs(s.timestamp) >= latestTs - 30 * 24 * 60 * 60 * 1000
      );

      if (yesterday) {
        dailyReturn = ((latest.totalValue - yesterday.totalValue) / yesterday.totalValue) * 100;
      }
      if (lastWeek) {
        weeklyReturn = ((latest.totalValue - lastWeek.totalValue) / lastWeek.totalValue) * 100;
      }
      if (lastMonth) {
        monthlyReturn = ((latest.totalValue - lastMonth.totalValue) / lastMonth.totalValue) * 100;
      }
    }

    // Calculate annualized APY (require 1 + totalReturn/100 > 0 for real exponent)
    const daysSinceStart = Math.max(
      (Date.now() - asDate(portfolio.createdAt).getTime()) / (1000 * 60 * 60 * 24),
      1 / 24
    );
    let annualizedApy = 0;
    const r = totalReturn / 100;
    if (1 + r > 0 && daysSinceStart > 0) {
      annualizedApy = (Math.pow(1 + r, 365 / daysSinceStart) - 1) * 100;
    } else if (r <= -1) {
      annualizedApy = -100;
    }

    // Calculate volatility from daily returns
    const volatility = this.calculateVolatility(history);

    // Calculate max drawdown
    const maxDrawdown = this.calculateMaxDrawdown(history);

    // Calculate Sortino ratio (simplified): allow negative excess return
    const sortinoRatio = volatility > 0 ? annualizedApy / volatility : 0;

    const exp = this.computeExpectedPositionMetrics(portfolio);

    return {
      totalReturn,
      dailyReturn,
      weeklyReturn,
      monthlyReturn,
      annualizedApy,
      sharpeRatio: sortinoRatio, // Simplified - use same value
      sortinoRatio,
      maxDrawdown,
      volatility,
      expectedApy: exp.expectedApy,
      expectedVolatility: exp.expectedVolatility,
      expectedSortinoRatio: exp.expectedSortinoRatio,
      feesPaid: stats.totalFees,
      slippageCosts: stats.totalFees * 0.3, // Estimate
      gasCosts: stats.totalFees * 0.7, // Estimate
      profitFactor: stats.losingTrades > 0 
        ? stats.winningTrades / stats.losingTrades 
        : stats.winningTrades,
      winRate: stats.totalTrades > 0 
        ? (stats.winningTrades / (stats.totalTrades / 2)) * 100
        : 0,
      averageHoldingPeriod: stats.averageHoldingPeriod,
      rebalanceCount: this.trades.get(portfolio.id)?.length || 0,
    };
  }

  private calculateVolatility(history: PortfolioSnapshot[]): number {
    if (history.length < 2) return 0;

    const returns: number[] = [];
    for (let i = 1; i < history.length; i++) {
      const prevVal = history[i - 1].totalValue;
      if (prevVal === 0 || !Number.isFinite(prevVal)) continue;
      const ret = (history[i].totalValue - prevVal) / prevVal;
      returns.push(ret);
    }
    if (returns.length === 0) return 0;

    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, ret) => sum + Math.pow(ret - mean, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    return stdDev * Math.sqrt(365) * 100; // Annualized volatility %
  }

  private calculateMaxDrawdown(history: PortfolioSnapshot[]): number {
    if (history.length < 2) return 0;

    let maxDrawdown = 0;
    let peak = history[0].totalValue;

    for (const snapshot of history) {
      if (snapshot.totalValue > peak) {
        peak = snapshot.totalValue;
      }
      const drawdown = (peak - snapshot.totalValue) / peak;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }

    return maxDrawdown * 100; // %
  }

  private initializeMetrics(): PerformanceMetrics {
    return {
      totalReturn: 0,
      dailyReturn: 0,
      weeklyReturn: 0,
      monthlyReturn: 0,
      annualizedApy: 0,
      sharpeRatio: 0,
      sortinoRatio: 0,
      maxDrawdown: 0,
      volatility: 0,
      expectedApy: 0,
      expectedVolatility: 0,
      expectedSortinoRatio: 0,
      feesPaid: 0,
      slippageCosts: 0,
      gasCosts: 0,
      profitFactor: 0,
      winRate: 0,
      averageHoldingPeriod: 0,
      rebalanceCount: 0,
    };
  }

  private async saveSnapshot(portfolio: Portfolio): Promise<void> {
    const snapshot: PortfolioSnapshot = {
      timestamp: new Date(),
      totalValue: portfolio.totalValue,
      positions: [...portfolio.positions],
      metrics: { ...portfolio.performanceMetrics },
    };

    const snapshots = this.snapshots.get(portfolio.id) || [];
    snapshots.push(snapshot);
    
    // Keep only last 90 days of snapshots
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const filtered = snapshots.filter(s => asTimeMs(s.timestamp) > cutoff);
    
    this.snapshots.set(portfolio.id, filtered);

    await this.saveToDisk();
  }

  // Update portfolio settings
  async updatePortfolio(id: string, updates: Partial<PortfolioSettings>): Promise<Portfolio> {
    const portfolio = this.portfolios.get(id);
    if (!portfolio) {
      throw new Error(`Portfolio ${id} not found`);
    }

    portfolio.settings = { ...portfolio.settings, ...updates };
    portfolio.updatedAt = new Date();

    await this.saveToDisk();

    logger.info('Portfolio updated', { portfolioId: id, updates });

    return portfolio;
  }

  // Delete portfolio
  async deletePortfolio(id: string): Promise<void> {
    const portfolio = this.portfolios.get(id);
    if (!portfolio) {
      throw new Error(`Portfolio ${id} not found`);
    }

    // Close all active positions first
    const activePositions = portfolio.positions.filter(p => p.status === 'ACTIVE');
    for (const position of activePositions) {
      await this.exitPosition(id, position.id, 'Portfolio deletion');
    }

    this.portfolios.delete(id);
    this.trades.delete(id);
    this.snapshots.delete(id);

    // Clean up positions that belonged to this portfolio
    for (const [positionId, position] of this.positions) {
      if (portfolio.positions.some(p => p.id === positionId)) {
        this.positions.delete(positionId);
      }
    }

    await this.saveToDisk();

    logger.info('Portfolio deleted', { portfolioId: id });
  }
}

export const portfolioService = new PortfolioService();
