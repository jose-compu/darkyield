import cron from 'node-cron';
import { 
  Portfolio, 
  RebalancePlan, 
  RebalanceAction,
  RebalanceFrequency,
  YieldMode,
} from '../../../shared/types/index.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { portfolioService } from './portfolio.js';
import { defiLlamaService } from './defillama.js';
import { optimizationService } from './optimizer.js';
import { riskService } from './risk.js';
import { telegramService } from './telegram.js';

export class SchedulerService {
  private rebalanceJobs: Map<string, cron.ScheduledTask> = new Map();
  private riskCheckJob: cron.ScheduledTask | null = null;
  private updateJob: cron.ScheduledTask | null = null;
  private isRunning: boolean = false;

  // Start all scheduled jobs
  start(): void {
    if (this.isRunning) {
      logger.warn('Scheduler already running');
      return;
    }

    this.isRunning = true;
    logger.info('Starting scheduler service');

    // Start portfolio update job (every 5 minutes)
    this.updateJob = cron.schedule('*/5 * * * *', async () => {
      await this.updateAllPortfolios();
    });

    // Start risk check job (based on config)
    const riskInterval = config.riskCheckInterval;
    if (riskInterval <= 60) {
      this.riskCheckJob = cron.schedule(`*/${riskInterval} * * * *`, async () => {
        await this.checkAllRisks();
      });
    } else {
      const hours = Math.floor(riskInterval / 60);
      this.riskCheckJob = cron.schedule(`0 */${hours} * * *`, async () => {
        await this.checkAllRisks();
      });
    }

    // Schedule portfolio rebalances
    for (const portfolio of portfolioService.getAllPortfolios()) {
      this.schedulePortfolioRebalance(portfolio);
    }

    logger.info('Scheduler service started');
  }

  // Stop all jobs
  stop(): void {
    this.isRunning = false;

    for (const [id, job] of this.rebalanceJobs) {
      job.stop();
      logger.info('Stopped rebalance job', { portfolioId: id });
    }
    this.rebalanceJobs.clear();

    this.riskCheckJob?.stop();
    this.updateJob?.stop();

    logger.info('Scheduler service stopped');
  }

  // Schedule rebalance for a portfolio
  schedulePortfolioRebalance(portfolio: Portfolio): void {
    // Stop existing job if any
    const existingJob = this.rebalanceJobs.get(portfolio.id);
    if (existingJob) {
      existingJob.stop();
    }

    const cronExpression = this.getCronExpression(portfolio.settings.rebalanceFrequency);
    
    const job = cron.schedule(cronExpression, async () => {
      await this.rebalancePortfolio(portfolio.id);
    });

    this.rebalanceJobs.set(portfolio.id, job);
    
    logger.info('Scheduled rebalance', { 
      portfolioId: portfolio.id, 
      frequency: portfolio.settings.rebalanceFrequency,
      cron: cronExpression,
    });
  }

  // Update all portfolios with current data
  private async updateAllPortfolios(): Promise<void> {
    const portfolios = portfolioService.getAllPortfolios();
    
    for (const portfolio of portfolios) {
      try {
        await portfolioService.updatePositions(portfolio.id);
        logger.debug('Updated portfolio', { portfolioId: portfolio.id });
      } catch (error) {
        logger.error('Failed to update portfolio', error as Error, { portfolioId: portfolio.id });
      }
    }
  }

  // Check risks for all portfolios
  private async checkAllRisks(): Promise<void> {
    const portfolios = portfolioService.getAllPortfolios();

    for (const portfolio of portfolios) {
      try {
        const riskAssessment = await riskService.assessPortfolio(portfolio);
        
        // Send alerts if needed
        if (riskAssessment.level !== 'LOW' && riskAssessment.level !== 'MODERATE') {
          const affectedPositions = portfolio.positions.filter(p => {
            const posRisk = riskAssessment.positionRisks?.get(p.id);
            return posRisk && posRisk.level !== 'LOW';
          });

          const alert = riskService.createRiskAlertEvent(
            portfolio.id,
            riskAssessment,
            affectedPositions
          );

          await telegramService.notifyRiskAlert(portfolio, alert);

          // Auto-execute risk actions if configured
          if (riskAssessment.level === 'EXTREME') {
            const riskActions = riskService.generateRiskActions(riskAssessment, portfolio);
            if (riskActions.length > 0) {
              const riskPlan: RebalancePlan = {
                id: `risk-${Date.now()}`,
                timestamp: new Date(),
                actions: riskActions,
                expectedReturn: 0,
                totalFees: riskActions.reduce((sum, a) => sum + a.expectedFees, 0),
                riskScore: riskAssessment.score,
                status: 'PENDING',
              };

              await portfolioService.executeRebalance(portfolio.id, riskPlan);
              await telegramService.notifyRebalance(portfolio, riskPlan, true);
            }
          }
        }
      } catch (error) {
        logger.error('Risk check failed', error as Error, { portfolioId: portfolio.id });
      }
    }
  }

  // Rebalance a single portfolio
  async rebalancePortfolio(portfolioId: string): Promise<RebalancePlan | null> {
    const portfolio = portfolioService.getPortfolio(portfolioId);
    if (!portfolio) {
      logger.error('Portfolio not found for rebalance', new Error('Portfolio not found'), { portfolioId });
      return null;
    }

    logger.info('Starting rebalance', { portfolioId, mode: portfolio.mode });

    try {
      // 1. Get current yield data
      const pools = await this.getPoolsForMode(portfolio.mode, portfolio.settings);
      
      // 2. Run risk assessment
      const riskAssessment = await riskService.assessPortfolio(portfolio);
      
      // 3. Generate optimization input
      const optimizationInput = {
        pools: pools.filter(p => 
          p.tvlUsd >= portfolio.settings.minPoolTvl &&
          p.apy >= portfolio.settings.apyThreshold
        ),
        availableCapital: portfolio.availableCash,
        constraints: {
          maxPools: config.maxConcurrentPositions,
          minPoolTvl: portfolio.settings.minPoolTvl,
          maxConcentration: portfolio.settings.maxPoolConcentration / 100,
          totalRiskBudget: riskAssessment.score < 60 ? 70 : 50,
          maxLockingPeriod: 7, // Prefer pools without long locks
          minApy: portfolio.settings.apyThreshold,
          excludedPools: portfolio.positions.map(p => p.poolId),
          requiredChains: undefined,
          maxGasPerRebalance: portfolio.settings.maxGasCostPerTrade,
        },
      objectives: {
        maximize: 'RISK_ADJUSTED_RETURN' as const,
          riskAversion: this.getRiskAversion(portfolio.mode),
          timeHorizon: this.getTimeHorizon(portfolio.settings.rebalanceFrequency),
          rebalanceFrequency: portfolio.settings.rebalanceFrequency,
        },
      };

      // 4. Run optimization
      const optimization = await optimizationService.optimize(optimizationInput);

      // 5. Calculate current allocations
      const currentAllocations = portfolio.actualAllocation;
      const targetAllocations = optimization.allocations;

      // 6. Calculate rebalance cost
      const rebalanceCost = optimizationService.calculateRebalanceCost(
        currentAllocations,
        targetAllocations,
        optimizationInput.constraints
      );

      // 7. Check if rebalance is worthwhile
      const minRebalanceThreshold = portfolio.settings.minRebalanceThreshold;
      const totalDeviation = currentAllocations.reduce((sum, a) => sum + Math.abs(a.deviation), 0);
      
      // Also check if new opportunities significantly better
      const currentAvgApy = portfolio.positions.reduce((sum, p) => 
        sum + p.currentApy * (p.amount / (portfolio.totalValue || 1)), 0
      );
      const newAvgApy = optimization.expectedReturn;
      const apyImprovement = newAvgApy - currentAvgApy;

      const shouldRebalance = 
        totalDeviation > minRebalanceThreshold ||
        apyImprovement > 2 || // Rebalance if we can improve APY by 2%+
        rebalanceCost.totalCost < (portfolio.totalValue * 0.005); // Cost < 0.5% of portfolio

      if (!shouldRebalance) {
        logger.info('Rebalance not needed', { 
          portfolioId, 
          deviation: totalDeviation,
          apyImprovement,
          cost: rebalanceCost.totalCost,
        });
        return null;
      }

      // 8. Generate rebalance actions
      const actions = this.generateRebalanceActions(
        portfolio,
        currentAllocations,
        targetAllocations,
        optimization
      );

      // 9. Create rebalance plan
      const plan: RebalancePlan = {
        id: `rebal-${Date.now()}`,
        timestamp: new Date(),
        actions,
        expectedReturn: optimization.expectedReturn,
        totalFees: rebalanceCost.totalCost,
        riskScore: optimization.expectedRisk,
        status: 'PENDING',
      };

      // 10. Notify and execute
      await telegramService.notifyRebalance(portfolio, plan, false);
      
      await portfolioService.executeRebalance(portfolio.id, plan);
      plan.status = 'COMPLETED';
      plan.executionTime = new Date();

      await telegramService.notifyRebalance(portfolio, plan, true);
      await telegramService.notifyPerformance(portfolio, portfolio.performanceMetrics);

      logger.info('Rebalance completed', { 
        portfolioId, 
        planId: plan.id,
        actions: actions.length,
      });

      return plan;
    } catch (error) {
      logger.error('Rebalance failed', error as Error, { portfolioId });
      await telegramService.notifyError('Rebalance failed', error as Error, { portfolioId });
      return null;
    }
  }

  // Get pools for specific mode
  private async getPoolsForMode(mode: YieldMode, settings: { minPoolTvl: number }): Promise<Array<{ id: string; chain: string; project: string; symbol: string; tvlUsd: number; apy: number; apyBase: number; apyReward: number; stablecoin: boolean; ilRisk: 'yes' | 'no' | 'medium' | 'high'; exposure: 'single' | 'multi'; riskScore?: number; apyPrediction?: { currentApy: number; predictedMinApy: number; confidence: 'LOW' | 'MEDIUM' | 'HIGH'; timeframe: string; expiresAt: Date } | undefined; volatilityScore?: number; lockingPeriod?: number; lastUpdated: Date }>> {
    switch (mode) {
      case YieldMode.STABLECOINS:
        return defiLlamaService.getStablecoinPools(settings.minPoolTvl);
      case YieldMode.BLUECHIPS:
        return defiLlamaService.getBluechipPools(settings.minPoolTvl * 10);
      case YieldMode.LONGTAIL:
        return defiLlamaService.getLongtailPools(settings.minPoolTvl / 2);
      default:
        return defiLlamaService.getAllPools();
    }
  }

  // Get risk aversion based on mode
  private getRiskAversion(mode: YieldMode): number {
    switch (mode) {
      case YieldMode.STABLECOINS:
        return 0.7; // Conservative
      case YieldMode.BLUECHIPS:
        return 0.5; // Moderate
      case YieldMode.LONGTAIL:
        return 0.3; // Risk-seeking
      case YieldMode.MEMECOINS:
        return 0.1; // High risk tolerance
      default:
        return 0.5;
    }
  }

  // Get time horizon based on rebalance frequency
  private getTimeHorizon(frequency: RebalanceFrequency): number {
    switch (frequency) {
      case RebalanceFrequency.HOURLY:
        return 1;
      case RebalanceFrequency.EVERY_8H:
        return 3;
      case RebalanceFrequency.EVERY_12H:
        return 5;
      case RebalanceFrequency.DAILY:
        return 7;
      default:
        return 7;
    }
  }

  // Convert frequency to cron expression
  private getCronExpression(frequency: RebalanceFrequency): string {
    switch (frequency) {
      case RebalanceFrequency.HOURLY:
        return '0 * * * *'; // Every hour
      case RebalanceFrequency.EVERY_8H:
        return '0 */8 * * *'; // Every 8 hours
      case RebalanceFrequency.EVERY_12H:
        return '0 */12 * * *'; // Every 12 hours
      case RebalanceFrequency.DAILY:
      default:
        return '0 2 * * *'; // Daily at 2 AM
    }
  }

  // Generate rebalance actions
  private generateRebalanceActions(
    portfolio: Portfolio,
    current: Array<{ poolId: string; currentValue: number; actualPercentage: number; targetPercentage: number; deviation: number }>,
    target: Array<{ poolId: string; targetPercentage: number; currentValue: number; actualPercentage: number; deviation: number }>,
    optimization: { expectedReturn: number; allocations: Array<{ poolId: string; targetPercentage: number; currentValue: number; actualPercentage: number; deviation: number }>; expectedRisk: number; expectedSortinoRatio: number; confidence: number; scenarioAnalysis: Array<{ name: string; probability: number; expectedReturn: number; maxLoss: number; description: string }> }
  ): RebalanceAction[] {
    const actions: RebalanceAction[] = [];
    const totalValue = portfolio.totalValue;

    // Exits - positions to reduce or close
    for (const currentAlloc of current) {
      const targetAlloc = target.find(t => t.poolId === currentAlloc.poolId);
      
      if (!targetAlloc || targetAlloc.targetPercentage === 0) {
        // Full exit
        const position = portfolio.positions.find(p => p.poolId === currentAlloc.poolId);
        if (position) {
          actions.push({
            type: 'EXIT',
            poolId: currentAlloc.poolId,
            currentAmount: currentAlloc.currentValue,
            targetAmount: 0,
            delta: -currentAlloc.currentValue,
            reason: targetAlloc ? 'Optimization removed from allocation' : 'Rebalancing to better opportunities',
            expectedApy: 0,
            expectedFees: currentAlloc.currentValue * 0.003,
            confidence: 0.85,
          });
        }
      } else if (targetAlloc.targetPercentage < currentAlloc.actualPercentage - portfolio.settings.minRebalanceThreshold) {
        // Partial reduction
        const targetValue = (targetAlloc.targetPercentage / 100) * totalValue;
        const reduction = currentAlloc.currentValue - targetValue;
        
        actions.push({
          type: 'REALLOCATE',
          poolId: currentAlloc.poolId,
          currentAmount: currentAlloc.currentValue,
          targetAmount: targetValue,
          delta: -reduction,
          reason: 'Reduce to target allocation',
          expectedApy: 0,
          expectedFees: reduction * 0.003,
          confidence: 0.8,
        });
      }
    }

    // Enters - new positions to add
    for (const targetAlloc of target) {
      const currentAlloc = current.find(c => c.poolId === targetAlloc.poolId);
      
      if (!currentAlloc && targetAlloc.targetPercentage > 0) {
        // New entry
        const targetValue = (targetAlloc.targetPercentage / 100) * totalValue;
        
        actions.push({
          type: 'ENTER',
          poolId: targetAlloc.poolId,
          targetAmount: targetValue,
          delta: targetValue,
          reason: 'New allocation from optimization',
          expectedApy: optimization.expectedReturn,
          expectedFees: targetValue * 0.003,
          confidence: optimization.confidence,
        });
      } else if (currentAlloc && targetAlloc.targetPercentage > currentAlloc.actualPercentage + portfolio.settings.minRebalanceThreshold) {
        // Increase existing position
        const targetValue = (targetAlloc.targetPercentage / 100) * totalValue;
        const increase = targetValue - currentAlloc.currentValue;
        
        actions.push({
          type: 'REALLOCATE',
          poolId: targetAlloc.poolId,
          currentAmount: currentAlloc.currentValue,
          targetAmount: targetValue,
          delta: increase,
          reason: 'Increase to target allocation',
          expectedApy: optimization.expectedReturn,
          expectedFees: increase * 0.003,
          confidence: 0.8,
        });
      }
    }

    return actions;
  }

  // Get scheduler status
  getStatus(): {
    isRunning: boolean;
    portfolioJobs: number;
    riskCheckActive: boolean;
    updateActive: boolean;
  } {
    return {
      isRunning: this.isRunning,
      portfolioJobs: this.rebalanceJobs.size,
      riskCheckActive: this.riskCheckJob !== null,
      updateActive: this.updateJob !== null,
    };
  }
}

export const schedulerService = new SchedulerService();
