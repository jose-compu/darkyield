import { 
  Pool, 
  OptimizationInput, 
  OptimizationResult, 
  Allocation,
  OptimizationConstraints,
  OptimizationObjectives,
  ScenarioResult,
} from '../../../shared/types/index.js';
import { logger } from '../utils/logger.js';

interface PoolMetrics {
  pool: Pool;
  riskAdjustedReturn: number;
  expectedReturn: number;
  variance: number;
  sortinoRatio: number;
  momentum: number;
  trendScore: number;
  liquidityScore: number;
  volatilityRisk: number; // Annualized volatility as percentage
  apyVolatilityRatio: number; // APY / Volatility - must be > 1 for investable
  riskAdjustedApy: number; // APY penalized by volatility
  maxDrawdownEstimate: number; // Estimated max drawdown based on volatility
  rewardToRiskRatio: number; // Expected return vs risk of loss
  // APY decay/increase analysis
  apyDecayRate: number; // Daily APY change rate (negative = decay, positive = increase)
  apyHalfLife: number; // Days until APY halves (if decaying) or doubles (if increasing)
  optimalHoldTime: number; // Recommended days to hold position
  deadlineToExit: Date | null; // When APY drops below acceptable threshold
  projectedApySeries: Array<{ day: number; projectedApy: number }>; // 30-day projection
  maxProfitDay: number; // Day when maximum profit is achieved
  totalReturnEstimate: number; // Total expected return over optimal hold time
}

export class OptimizationService {
  // Main optimization function
  async optimize(
    input: OptimizationInput
  ): Promise<OptimizationResult> {
    const { pools, availableCapital, constraints, objectives } = input;

    logger.info('Starting portfolio optimization', {
      poolCount: pools.length,
      availableCapital,
      objective: objectives.maximize,
    });

    // Filter pools based on constraints
    const eligiblePools = this.filterEligiblePools(pools, constraints);

    if (eligiblePools.length === 0) {
      throw new Error('No eligible pools found for optimization');
    }

    // Calculate metrics for each pool
    const poolMetrics = this.calculatePoolMetrics(eligiblePools, input.historicalData);

    // Apply objective function
    let allocations: Allocation[];
    switch (objectives.maximize) {
      case 'APY':
        allocations = this.optimizeForYield(poolMetrics, availableCapital, constraints, objectives);
        break;
      case 'RISK_ADJUSTED_RETURN':
        allocations = this.optimizeRiskAdjusted(poolMetrics, availableCapital, constraints, objectives);
        break;
      case 'SORTINO_RATIO':
        allocations = this.optimizeSortino(poolMetrics, availableCapital, constraints, objectives);
        break;
      default:
        allocations = this.optimizeRiskAdjusted(poolMetrics, availableCapital, constraints, objectives);
    }

    // Calculate expected results
    const expectedReturn = this.calculateExpectedReturn(allocations, poolMetrics);
    const expectedRisk = this.calculatePortfolioRisk(allocations, poolMetrics);
    const expectedSortino = this.calculatePortfolioSortino(allocations, poolMetrics, expectedReturn);

    // Run scenario analysis
    const scenarioAnalysis = this.runScenarioAnalysis(allocations, poolMetrics, objectives);

    // Calculate confidence based on data quality
    const confidence = this.calculateConfidence(poolMetrics, allocations);

    // Calculate pool decay metrics for UI display
    const poolDecayMetrics = poolMetrics.map(m => ({
      poolId: m.pool.id,
      symbol: m.pool.symbol,
      apyDecayRate: m.apyDecayRate,
      apyHalfLife: m.apyHalfLife,
      optimalHoldTime: m.optimalHoldTime,
      deadlineToExit: m.deadlineToExit || undefined,
      projectedApySeries: m.projectedApySeries,
      maxProfitDay: m.maxProfitDay,
      totalReturnEstimate: m.totalReturnEstimate,
      recommendation: this.generateTimeRecommendation(m),
    }));
    
    // Calculate average hold time across allocations
    const averageHoldTime = allocations.length > 0
      ? allocations.reduce((sum, a) => sum + (a.recommendedHoldTime || 30), 0) / allocations.length
      : 0;
    
    // Generate overall portfolio recommendation
    const overallRecommendation = this.generateOverallRecommendation(allocations, poolMetrics, averageHoldTime);

    logger.info('Optimization complete', {
      allocationsCount: allocations.length,
      expectedReturn,
      expectedRisk,
      confidence,
      averageHoldTime,
    });

    return {
      allocations,
      expectedReturn,
      expectedRisk,
      expectedSortinoRatio: expectedSortino,
      confidence,
      scenarioAnalysis,
      poolDecayMetrics,
      overallRecommendation,
      averageHoldTime,
    };
  }

  // Generate time-based recommendation for a single pool
  private generateTimeRecommendation(metric: PoolMetrics): string {
    const { apyDecayRate, optimalHoldTime, maxProfitDay, pool } = metric;
    
    if (apyDecayRate < -0.05) {
      // Rapid decay - exit quickly
      return `URGENT: APY dropping ${(apyDecayRate * 100).toFixed(2)}% daily. Exit within ${optimalHoldTime} days before profitability erodes.`;
    } else if (apyDecayRate < -0.01) {
      // Moderate decay
      return `SHORT-TERM: APY declining ${(apyDecayRate * 100).toFixed(2)}% daily. Hold ${optimalHoldTime} days, exit by day ${maxProfitDay} for max profit.`;
    } else if (apyDecayRate > 0.02) {
      // Growing APY
      return `GROWTH: APY increasing ${(apyDecayRate * 100).toFixed(2)}% daily. Can hold longer, monitor for peak at day ${maxProfitDay}.`;
    } else {
      // Stable APY
      return `STABLE: APY relatively stable. Hold ${optimalHoldTime} days for optimal risk-adjusted return.`;
    }
  }

  // Generate overall portfolio time strategy
  private generateOverallRecommendation(
    allocations: Allocation[],
    metrics: PoolMetrics[],
    averageHoldTime: number
  ): string {
    if (allocations.length === 0) {
      return 'No allocations recommended at this time.';
    }
    
    const shortTermPositions = allocations.filter(a => (a.recommendedHoldTime || 30) <= 3).length;
    const mediumTermPositions = allocations.filter(a => {
      const days = a.recommendedHoldTime || 30;
      return days > 3 && days <= 10;
    }).length;
    const longTermPositions = allocations.filter(a => (a.recommendedHoldTime || 30) > 10).length;
    
    const decayingPositions = metrics.filter(m => m.apyDecayRate < -0.01).length;
    const growingPositions = metrics.filter(m => m.apyDecayRate > 0.01).length;
    
    let recommendation = `Portfolio Strategy: Average hold time ${averageHoldTime.toFixed(1)} days. `;
    
    if (shortTermPositions > 0) {
      recommendation += `${shortTermPositions} positions need rapid exit (≤3 days). `;
    }
    if (decayingPositions > growingPositions) {
      recommendation += `Most APYs are declining - prioritize quick rotations. `;
    } else if (growingPositions > decayingPositions) {
      recommendation += `Favorable environment - APYs trending upward. `;
    }
    
    recommendation += 'Monitor positions daily and rebalance when deadlines approach.';
    
    return recommendation;
  }

  // Filter pools based on constraints
  private filterEligiblePools(
    pools: Pool[],
    constraints: OptimizationConstraints
  ): Pool[] {
    return pools.filter(pool => {
      // Minimum TVL
      if (pool.tvlUsd < constraints.minPoolTvl) {
        return false;
      }

      // Excluded pools
      if (constraints.excludedPools.includes(pool.id)) {
        return false;
      }

      // Required chains
      if (constraints.requiredChains && !constraints.requiredChains.includes(pool.chain)) {
        return false;
      }

      // Minimum APY
      if (pool.apy < constraints.minApy) {
        return false;
      }

      // Maximum locking period
      if (pool.lockingPeriod && pool.lockingPeriod > constraints.maxLockingPeriod) {
        return false;
      }

      // Risk budget check
      if (pool.riskScore && pool.riskScore > constraints.totalRiskBudget) {
        return false;
      }

      // === VOLATILITY RISK vs APY CHECK ===
      
      // Calculate volatility from risk score or volatility score
      const volatility = pool.volatilityScore || (pool.riskScore || 50) / 5;
      
      // CRITICAL: Reject pools where volatility > APY (risk exceeds reward)
      // We require APY to be at least 1.2x the volatility for minimum safety
      const minApyVolatilityRatio = 1.2;
      const apyVolatilityRatio = volatility > 0 ? pool.apy / volatility : 999;
      
      if (apyVolatilityRatio < minApyVolatilityRatio) {
        logger.debug('Pool rejected: APY/volatility ratio too low', {
          pool: pool.id,
          apy: pool.apy,
          volatility,
          ratio: apyVolatilityRatio,
        });
        return false;
      }
      
      // Estimate max drawdown (~2x volatility for 95% confidence)
      const maxDrawdownEstimate = volatility * 2;
      
      // Reject if estimated max drawdown significantly exceeds APY
      // Allow buffer: drawdown can be up to 2x the APY before rejecting
      // This accounts for temporary volatility spikes while still protecting capital
      if (maxDrawdownEstimate > pool.apy * 2.0) {
        logger.debug('Pool rejected: Max drawdown risk too high', {
          pool: pool.id,
          apy: pool.apy,
          estimatedMaxDrawdown: maxDrawdownEstimate,
          threshold: pool.apy * 2.0,
        });
        return false;
      }

      return true;
    });
  }

  /**
   * Second-stage pool pick for allocation builders. The old thresholds (APY/vol ≥ 1.5 and reward/risk ≥ 1)
   * almost never hold: rewardToRisk = apy/(2·vol), so ≥1 implies apy ≥ 2·vol, while eligibility only required ≥1.2·vol on APY.
   * Stablecoins are treated more leniently because volatility penalties already passed filterEligiblePools.
   */
  private selectInvestableMetrics(metrics: PoolMetrics[]): PoolMetrics[] {
    const primary = metrics.filter((m) => {
      if (m.pool.stablecoin) {
        return m.pool.apy > 0;
      }
      return (
        m.apyVolatilityRatio >= 1.2 &&
        m.rewardToRiskRatio >= 0.25 &&
        m.riskAdjustedApy > 0
      );
    });
    if (primary.length > 0) {
      return primary;
    }
    const fallback = metrics.filter(
      (m) => m.pool.apy > 0 && m.apyVolatilityRatio >= 1.0
    );
    if (fallback.length > 0) {
      logger.warn('Using relaxed investable pool selection (APY/volatility ≥ 1.0)');
      return fallback;
    }
    const lastResort = metrics.filter((m) => m.pool.apy > 0);
    if (lastResort.length > 0) {
      logger.warn('Using minimum investable selection (positive APY only)');
    }
    return lastResort;
  }

  // Calculate comprehensive metrics for each pool
  private calculatePoolMetrics(
    pools: Pool[],
    historicalData?: Array<{ timestamp: Date; poolId: string; apy: number; tvl: number }>
  ): PoolMetrics[] {
    return pools.map(pool => {
      const poolHistory = historicalData?.filter(h => h.poolId === pool.id) || [];
      
      // Calculate variance from historical APY if available
      let variance = 0;
      let volatilityRisk = pool.volatilityScore || 0;
      
      if (poolHistory.length >= 7) {
        const apys = poolHistory.map(h => h.apy);
        const mean = apys.reduce((a, b) => a + b, 0) / apys.length;
        variance = apys.reduce((sum, apy) => sum + Math.pow(apy - mean, 2), 0) / apys.length;
        volatilityRisk = Math.sqrt(variance);
      } else if (pool.volatilityScore) {
        variance = Math.pow(pool.volatilityScore, 2);
        volatilityRisk = pool.volatilityScore;
      } else {
        // Estimate variance from risk score (riskScore 0-100 maps to volatility 0-20%)
        volatilityRisk = (pool.riskScore || 50) / 5;
        variance = Math.pow(volatilityRisk, 2);
      }

      // Calculate momentum (trend direction)
      let momentum = 0;
      if (pool.apyTrend7d !== undefined && pool.apyTrend30d !== undefined) {
        momentum = (pool.apyTrend7d * 0.6 + pool.apyTrend30d * 0.4) / 100;
      }

      // Calculate trend score (1 = positive, 0 = neutral, -1 = negative)
      const trendScore = momentum > 0.05 ? 1 : momentum < -0.05 ? -1 : 0;

      // Calculate liquidity score based on TVL
      const liquidityScore = Math.min(Math.log10(pool.tvlUsd) / 8, 1);

      // === VOLATILITY RISK vs APY ANALYSIS ===
      
      // APY must significantly exceed volatility for investment to make sense
      // We use a minimum threshold where APY > volatility * minRiskRewardRatio
      const minRiskRewardRatio = 1.5; // APY should be at least 1.5x the volatility
      
      // Calculate APY / Volatility ratio
      const apyVolatilityRatio = volatilityRisk > 0 
        ? pool.apy / volatilityRisk 
        : 999; // If no volatility, ratio is very high
      
      // Calculate risk-adjusted APY that penalizes high volatility
      // Formula: Adjusted APY = APY - (volatility * volatilityPenaltyFactor)
      const volatilityPenaltyFactor = 0.8; // Each 1% of volatility costs 0.8% of APY
      const riskAdjustedApy = pool.apy - (volatilityRisk * volatilityPenaltyFactor);
      
      // Estimate max drawdown using volatility (simplified: ~2x volatility for 95% confidence)
      const maxDrawdownEstimate = volatilityRisk * 2;
      
      // Calculate reward-to-risk ratio
      // If max drawdown exceeds expected annual return, risk > reward
      const rewardToRiskRatio = maxDrawdownEstimate > 0 
        ? pool.apy / maxDrawdownEstimate 
        : 999;
      
      // Risk-adjusted expected return (original method enhanced)
      const riskAdjustment = 1 - ((pool.riskScore || 50) / 200);
      const expectedReturn = pool.apy * riskAdjustment;

      // Calculate Sortino-like ratio using risk-adjusted APY
      const downsideDeviation = Math.sqrt(variance) * 0.7;
      const sortinoRatio = downsideDeviation > 0 
        ? riskAdjustedApy / downsideDeviation 
        : riskAdjustedApy;

      // === APY DECAY/INCREASE ANALYSIS ===
      // Estimate how APY changes over time to determine optimal hold period
      
      // Calculate daily APY change rate from trends
      // Use 7d and 30d trends to estimate daily rate
      let apyDecayRate = 0; // Negative = decay, Positive = increase
      
      if (pool.apyTrend7d !== undefined && pool.apyTrend30d !== undefined) {
        // Convert percentage trends to daily rates
        // 7d trend is over 7 days, 30d trend is over 30 days
        const dailyRate7d = (pool.apyTrend7d / 100) / 7;
        const dailyRate30d = (pool.apyTrend30d / 100) / 30;
        // Weight recent trend more heavily (70% 7d, 30% 30d)
        apyDecayRate = (dailyRate7d * 0.7) + (dailyRate30d * 0.3);
      } else if (pool.apyTrend7d !== undefined) {
        apyDecayRate = (pool.apyTrend7d / 100) / 7;
      } else if (pool.apyTrend30d !== undefined) {
        apyDecayRate = (pool.apyTrend30d / 100) / 30;
      } else if (momentum !== 0) {
        // Estimate from momentum if no trend data
        apyDecayRate = momentum * 0.01; // Scale momentum to daily rate
      }
      
      // Calculate half-life: days until APY halves (decay) or doubles (growth)
      // Using exponential decay/growth formula: N = N0 * e^(rt)
      // Solve for t when N = N0/2 (decay) or N = 2*N0 (growth)
      let apyHalfLife = Infinity;
      if (apyDecayRate !== 0) {
        // For decay: t = ln(0.5) / r, For growth: t = ln(2) / r
        apyHalfLife = Math.abs(Math.log(apyDecayRate > 0 ? 2 : 0.5) / apyDecayRate);
      }
      
      // Generate 30-day APY projection
      const projectedApySeries: Array<{ day: number; projectedApy: number }> = [];
      const minAcceptableApy = Math.max(volatilityRisk * 1.5, 1.0); // APY must cover volatility + 1% minimum
      
      for (let day = 0; day <= 30; day++) {
        let projectedApy: number;
        if (apyDecayRate !== 0) {
          // Exponential projection
          projectedApy = (pool.apy / 100) * Math.exp(apyDecayRate * day) * 100;
        } else {
          // Flat projection
          projectedApy = pool.apy;
        }
        // Cap unrealistic growth (max 3x current APY)
        projectedApy = Math.min(projectedApy, pool.apy * 3);
        // Floor at 0
        projectedApy = Math.max(0, projectedApy);
        projectedApySeries.push({ day, projectedApy });
      }
      
      // Calculate optimal hold time - when to exit for maximum profit
      // Consider both APY decay and volatility risk
      let optimalHoldTime = 30; // Default 30 days
      let maxProfitDay = 0;
      let maxCumulativeReturn = 0;
      let totalReturnEstimate = 0;
      
      // Find the day when cumulative return peaks (accounting for decay)
      let cumulativeReturn = 0;
      for (let day = 0; day <= 30; day++) {
        const dailyApy = projectedApySeries[day].projectedApy;
        // Daily return = APY / 365
        const dailyReturn = (dailyApy / 100) / 365;
        cumulativeReturn += dailyReturn;

        // Also add volatility penalty that increases over time
        // Longer hold = more exposure to volatility
        const timeAdjustedVolatilityPenalty = ((volatilityRisk / 100) / 365) * day * 0.1;
        const adjustedCumulativeReturn = cumulativeReturn - timeAdjustedVolatilityPenalty;
        
        if (adjustedCumulativeReturn > maxCumulativeReturn) {
          maxCumulativeReturn = adjustedCumulativeReturn;
          maxProfitDay = day;
        }
        
        // Check if APY drops below acceptable threshold
        if (dailyApy < minAcceptableApy && optimalHoldTime === 30) {
          optimalHoldTime = day;
        }
      }
      
      // Optimal hold time is the earlier of max profit day or APY floor hit
      optimalHoldTime = Math.min(maxProfitDay > 0 ? maxProfitDay : 30, optimalHoldTime);
      // At least hold for 1 day, max 30 days
      optimalHoldTime = Math.max(1, Math.min(30, optimalHoldTime));
      
      // Calculate total expected return over hold period
      totalReturnEstimate = maxCumulativeReturn * 100;
      
      // Calculate deadline to exit (when APY becomes unfavorable)
      let deadlineToExit: Date | null = null;
      if (optimalHoldTime < 30) {
        const deadline = new Date();
        deadline.setDate(deadline.getDate() + optimalHoldTime);
        deadlineToExit = deadline;
      }

      return {
        pool,
        riskAdjustedReturn: riskAdjustedApy,
        expectedReturn,
        variance,
        sortinoRatio,
        momentum,
        trendScore,
        liquidityScore,
        volatilityRisk,
        apyVolatilityRatio,
        riskAdjustedApy,
        maxDrawdownEstimate,
        rewardToRiskRatio,
        apyDecayRate,
        apyHalfLife,
        optimalHoldTime,
        deadlineToExit,
        projectedApySeries,
        maxProfitDay,
        totalReturnEstimate,
      };
    });
  }

  // Optimize for maximum yield (with risk constraints)
  private optimizeForYield(
    metrics: PoolMetrics[],
    capital: number,
    constraints: OptimizationConstraints,
    objectives: OptimizationObjectives
  ): Allocation[] {
    const investableMetrics = this.selectInvestableMetrics(metrics);
    
    if (investableMetrics.length === 0) {
      logger.warn('No investable pools found - all have excessive volatility risk');
      return [];
    }
    
    // Sort by RISK-ADJUSTED APY (not raw APY), highest first
    // This ensures we don't chase high APYs with dangerous volatility
    const sorted = [...investableMetrics].sort((a, b) => b.riskAdjustedApy - a.riskAdjustedApy);
    
    // Select top N pools based on maxPools constraint
    const selected = sorted.slice(0, constraints.maxPools);
    
    // Apply concentration limits and calculate allocations
    const allocations: Allocation[] = [];
    let remainingCapital = capital;
    const maxPerPool = capital * constraints.maxConcentration;

    // Normalize risk-adjusted APYs for weighting
    const totalRiskAdjustedApy = selected.reduce((sum, m) => sum + Math.max(m.riskAdjustedApy, 0), 0);

    for (const metric of selected) {
      if (remainingCapital <= 0) break;
      
      // Skip pools with negative risk-adjusted APY
      if (metric.riskAdjustedApy <= 0) continue;

      // Weight by risk-adjusted APY
      const weight = totalRiskAdjustedApy > 0 
        ? metric.riskAdjustedApy / totalRiskAdjustedApy 
        : 1 / selected.length;
      let targetAmount = capital * weight;

      // Apply concentration limit
      targetAmount = Math.min(targetAmount, maxPerPool);
      targetAmount = Math.min(targetAmount, remainingCapital);

      // Minimum investment threshold (to avoid dust)
      if (targetAmount < 100) continue;

      allocations.push({
        poolId: metric.pool.id,
        targetPercentage: (targetAmount / capital) * 100,
        actualPercentage: 0,
        currentValue: 0,
        deviation: 0,
        // APY decay/time-based fields
        recommendedHoldTime: metric.optimalHoldTime,
        deadlineToExit: metric.deadlineToExit || undefined,
        projectedApySeries: metric.projectedApySeries,
        apyDecayRate: metric.apyDecayRate,
        totalReturnEstimate: metric.totalReturnEstimate,
        maxProfitDay: metric.maxProfitDay,
      });

      remainingCapital -= targetAmount;
    }

    // Redistribute remaining capital proportionally
    if (remainingCapital > 100 && allocations.length > 0) {
      const perPool = remainingCapital / allocations.length;
      for (const alloc of allocations) {
        const additional = Math.min(perPool, capital * constraints.maxConcentration - (alloc.targetPercentage / 100 * capital));
        alloc.targetPercentage = ((alloc.targetPercentage / 100 * capital + additional) / capital) * 100;
      }
    }

    return allocations;
  }

  // Optimize for risk-adjusted return
  private optimizeRiskAdjusted(
    metrics: PoolMetrics[],
    capital: number,
    constraints: OptimizationConstraints,
    objectives: OptimizationObjectives
  ): Allocation[] {
    const riskAversion = objectives.riskAversion;

    const investableMetrics = this.selectInvestableMetrics(metrics);
    
    if (investableMetrics.length === 0) {
      logger.warn('No investable pools found for risk-adjusted optimization');
      return [];
    }

    // Calculate utility score for each pool
    // Enhanced formula: Utility = RiskAdjustedApy - RiskAversion * VolatilityRisk
    // This directly penalizes volatility while rewarding risk-adjusted yield
    const scoredMetrics = investableMetrics.map(m => {
      // Calculate composite risk score
      const compositeRisk = m.volatilityRisk + m.maxDrawdownEstimate * 0.5;
      
      // Utility score: higher is better
      // High risk aversion strongly penalizes volatility
      const utilityScore = m.riskAdjustedApy - (riskAversion * compositeRisk);
      
      return {
        ...m,
        utilityScore,
        // Also calculate a "window score" - how attractive is current timing
        // Higher when APY is high relative to historical volatility
        timingScore: m.apyVolatilityRatio,
      };
    });

    // Sort by utility score
    const sorted = scoredMetrics.sort((a, b) => b.utilityScore - a.utilityScore);
    const selected = sorted.slice(0, constraints.maxPools);

    // Calculate allocations using mean-variance optimization (simplified)
    const allocations: Allocation[] = [];
    let totalUtility = selected.reduce((sum, m) => Math.max(m.utilityScore, 0), 0);

    for (const metric of selected) {
      if (metric.utilityScore <= 0) continue;

      const weight = totalUtility > 0 ? metric.utilityScore / totalUtility : 1 / selected.length;
      let targetAmount = capital * weight;

      // Apply concentration limit
      targetAmount = Math.min(targetAmount, capital * constraints.maxConcentration);

      // Minimum threshold
      if (targetAmount < 100) continue;

      allocations.push({
        poolId: metric.pool.id,
        targetPercentage: (targetAmount / capital) * 100,
        actualPercentage: 0,
        currentValue: 0,
        deviation: 0,
        // APY decay/time-based fields
        recommendedHoldTime: metric.optimalHoldTime,
        deadlineToExit: metric.deadlineToExit || undefined,
        projectedApySeries: metric.projectedApySeries,
        apyDecayRate: metric.apyDecayRate,
        totalReturnEstimate: metric.totalReturnEstimate,
        maxProfitDay: metric.maxProfitDay,
      });
    }

    // If every utility score was <= 0 (common for conservative risk aversion + volatility penalty), still allocate by APY
    if (allocations.length === 0 && selected.length > 0) {
      logger.warn('Risk-adjusted utilities all non-positive; allocating by raw APY among eligible pools');
      const weights = selected.map(m => Math.max(m.pool.apy, 0.01));
      const weightSum = weights.reduce((a, b) => a + b, 0);
      for (let i = 0; i < selected.length; i++) {
        const m = selected[i];
        let targetAmount = capital * (weights[i] / weightSum);
        targetAmount = Math.min(targetAmount, capital * constraints.maxConcentration);
        if (targetAmount < 100) continue;
        allocations.push({
          poolId: m.pool.id,
          targetPercentage: (targetAmount / capital) * 100,
          actualPercentage: 0,
          currentValue: 0,
          deviation: 0,
          recommendedHoldTime: m.optimalHoldTime,
          deadlineToExit: m.deadlineToExit || undefined,
          projectedApySeries: m.projectedApySeries,
          apyDecayRate: m.apyDecayRate,
          totalReturnEstimate: m.totalReturnEstimate,
          maxProfitDay: m.maxProfitDay,
        });
      }
    }

    // Normalize percentages
    const totalPercentage = allocations.reduce((sum, a) => sum + a.targetPercentage, 0);
    if (totalPercentage > 0 && Math.abs(totalPercentage - 100) > 0.01) {
      const factor = 100 / totalPercentage;
      for (const alloc of allocations) {
        alloc.targetPercentage *= factor;
      }
    }

    return allocations;
  }

  // Optimize for maximum Sortino ratio
  private optimizeSortino(
    metrics: PoolMetrics[],
    capital: number,
    constraints: OptimizationConstraints,
    objectives: OptimizationObjectives
  ): Allocation[] {
    const investableMetrics = this.selectInvestableMetrics(metrics);
    
    if (investableMetrics.length === 0) {
      logger.warn('No investable pools found for Sortino optimization');
      return [];
    }
    
    // Sort by Sortino ratio, highest first
    // Sortino now uses risk-adjusted APY in numerator
    const sorted = [...investableMetrics].sort((a, b) => b.sortinoRatio - a.sortinoRatio);
    
    let filtered = sorted.filter(m => m.sortinoRatio > 1.0);
    if (filtered.length === 0) {
      filtered = sorted.filter(m => m.sortinoRatio > 0);
    }
    if (filtered.length === 0) {
      filtered = sorted;
    }
    const selected = filtered.slice(0, constraints.maxPools);

    // Weight by Sortino ratio
    const totalSortino = selected.reduce((sum, m) => m.sortinoRatio, 0);

    const allocations: Allocation[] = [];
    for (const metric of selected) {
      const weight = totalSortino > 0 ? metric.sortinoRatio / totalSortino : 1 / selected.length;
      let targetAmount = capital * weight;

      // Apply concentration limit
      targetAmount = Math.min(targetAmount, capital * constraints.maxConcentration);

      if (targetAmount < 100) continue;

      allocations.push({
        poolId: metric.pool.id,
        targetPercentage: (targetAmount / capital) * 100,
        actualPercentage: 0,
        currentValue: 0,
        deviation: 0,
        // APY decay/time-based fields
        recommendedHoldTime: metric.optimalHoldTime,
        deadlineToExit: metric.deadlineToExit || undefined,
        projectedApySeries: metric.projectedApySeries,
        apyDecayRate: metric.apyDecayRate,
        totalReturnEstimate: metric.totalReturnEstimate,
        maxProfitDay: metric.maxProfitDay,
      });
    }

    return allocations;
  }

  // Calculate expected portfolio return using risk-adjusted APY
  private calculateExpectedReturn(
    allocations: Allocation[],
    metrics: PoolMetrics[]
  ): number {
    let totalReturn = 0;
    let totalVolatility = 0;
    
    for (const alloc of allocations) {
      const metric = metrics.find(m => m.pool.id === alloc.poolId);
      if (metric) {
        // Use risk-adjusted APY for expected return
        totalReturn += (alloc.targetPercentage / 100) * metric.riskAdjustedApy;
        totalVolatility += (alloc.targetPercentage / 100) * metric.volatilityRisk;
      }
    }
    
    // Calculate portfolio-level APY/volatility ratio
    const portfolioRatio = totalVolatility > 0 ? totalReturn / totalVolatility : 0;
    
    logger.info('Portfolio risk metrics', {
      expectedRiskAdjustedReturn: totalReturn,
      expectedVolatility: totalVolatility,
      apyVolatilityRatio: portfolioRatio,
    });
    
    return totalReturn;
  }

  // Calculate portfolio risk (simplified - assumes some correlation)
  private calculatePortfolioRisk(
    allocations: Allocation[],
    metrics: PoolMetrics[]
  ): number {
    let totalVariance = 0;
    
    for (const alloc of allocations) {
      const metric = metrics.find(m => m.pool.id === alloc.poolId);
      if (metric) {
        // Weighted variance (simplified - assumes 0.5 correlation between pools)
        totalVariance += Math.pow(alloc.targetPercentage / 100, 2) * metric.variance;
      }
    }

    // Add diversification benefit (reduce risk for multiple pools)
    const diversificationFactor = 1 - (allocations.length * 0.03); // 3% reduction per additional pool
    totalVariance *= Math.max(0.6, diversificationFactor);

    return Math.sqrt(totalVariance) * 100; // Standard deviation as percentage
  }

  // Calculate portfolio Sortino ratio
  private calculatePortfolioSortino(
    allocations: Allocation[],
    metrics: PoolMetrics[],
    expectedReturn: number
  ): number {
    // Calculate weighted downside deviation
    let weightedDownside = 0;
    for (const alloc of allocations) {
      const metric = metrics.find(m => m.pool.id === alloc.poolId);
      if (metric) {
        // Estimate downside deviation as 70% of total std dev
        const downsideDeviation = Math.sqrt(metric.variance) * 0.7;
        weightedDownside += (alloc.targetPercentage / 100) * downsideDeviation;
      }
    }

    return weightedDownside > 0 ? expectedReturn / weightedDownside : 0;
  }

  // Run scenario analysis
  private runScenarioAnalysis(
    allocations: Allocation[],
    metrics: PoolMetrics[],
    objectives: OptimizationObjectives
  ): ScenarioResult[] {
    const scenarios: ScenarioResult[] = [];
    const baseReturn = this.calculateExpectedReturn(allocations, metrics);
    
    // Calculate portfolio volatility metrics
    const portfolioVolatility = allocations.reduce((sum, alloc) => {
      const metric = metrics.find(m => m.pool.id === alloc.poolId);
      return sum + (alloc.targetPercentage / 100) * (metric?.volatilityRisk || 0);
    }, 0);

    // Bull scenario: APYs increase by 50%, volatility stays constant
    const bullMetrics = metrics.map(m => ({
      ...m,
      riskAdjustedApy: m.riskAdjustedApy * 1.5,
    }));
    const bullReturn = this.calculateExpectedReturn(allocations, bullMetrics);
    scenarios.push({
      name: 'Bull Market',
      probability: 0.20,
      expectedReturn: bullReturn,
      maxLoss: 0,
      description: 'APYs increase significantly due to high demand, maintaining positive risk/reward',
    });

    // Optimal window: Current timing is good (APY > volatility)
    const goodTimingMetrics = metrics.filter(m => m.apyVolatilityRatio >= 2.0);
    const timingScore = goodTimingMetrics.length / metrics.length;
    scenarios.push({
      name: 'Optimal Entry Window',
      probability: timingScore * 0.30, // Higher probability if more pools have good timing
      expectedReturn: baseReturn * 1.2,
      maxLoss: -portfolioVolatility, // Max loss estimated by volatility
      description: `APY/volatility ratio is favorable (${(baseReturn/portfolioVolatility).toFixed(2)}x), good time to enter`,
    });

    // Base case: Expected returns
    scenarios.push({
      name: 'Base Case',
      probability: 0.35,
      expectedReturn: baseReturn,
      maxLoss: -Math.min(baseReturn * 0.3, portfolioVolatility * 1.5), 
      description: 'Market conditions as expected, APY exceeds volatility risk',
    });

    // Bear scenario: APYs drop by 30% but volatility stays
    const bearMetrics = metrics.map(m => ({
      ...m,
      riskAdjustedApy: Math.max(0, m.riskAdjustedApy * 0.7 - m.volatilityRisk * 0.2), // APY drops, some vol persists
    }));
    const bearReturn = this.calculateExpectedReturn(allocations, bearMetrics);
    scenarios.push({
      name: 'Bear Market',
      probability: 0.15,
      expectedReturn: bearReturn,
      maxLoss: -Math.max(baseReturn * 0.6, portfolioVolatility * 2),
      description: 'APYs decline, risk/reward becomes marginal - consider exiting',
    });

    // Volatility spike scenario: Volatility exceeds APY (worst case)
    const volSpikeMetrics = metrics.map(m => ({
      ...m,
      riskAdjustedApy: Math.max(-5, m.riskAdjustedApy - m.volatilityRisk * 1.5), // Volatility spike erodes returns
    }));
    const volSpikeReturn = this.calculateExpectedReturn(allocations, volSpikeMetrics);
    scenarios.push({
      name: 'Volatility Spike',
      probability: 0.05,
      expectedReturn: volSpikeReturn,
      maxLoss: -portfolioVolatility * 3, // Severe drawdown possible
      description: 'EXTREME: Token volatility exceeds APY, positions may lose value - EXIT IMMEDIATELY',
    });

    // Extreme scenario: Protocol issues / exploits
    scenarios.push({
      name: 'Protocol Risk',
      probability: 0.05,
      expectedReturn: -25, // Significant loss possible
      maxLoss: -50,
      description: 'Smart contract exploit or protocol failure in one position',
    });

    return scenarios;
  }

  // Calculate confidence in the optimization result
  private calculateConfidence(
    metrics: PoolMetrics[],
    allocations: Allocation[]
  ): number {
    let confidence = 0.7; // Base confidence

    // Increase confidence if we have high-quality data
    const poolsWithPredictions = metrics.filter(m => m.pool.apyPrediction).length;
    confidence += (poolsWithPredictions / metrics.length) * 0.1;

    // Increase confidence for higher TVL pools
    const avgTvl = metrics.reduce((sum, m) => sum + m.pool.tvlUsd, 0) / metrics.length;
    if (avgTvl > 10_000_000) confidence += 0.05;
    if (avgTvl > 100_000_000) confidence += 0.05;

    // === APY vs VOLATILITY CONFIDENCE FACTORS ===
    
    // Calculate average APY/volatility ratio
    const avgApyVolRatio = metrics.reduce((sum, m) => sum + m.apyVolatilityRatio, 0) / metrics.length;
    
    // Strong confidence boost when APY significantly exceeds volatility
    if (avgApyVolRatio >= 3.0) {
      confidence += 0.15; // Excellent risk/reward
    } else if (avgApyVolRatio >= 2.0) {
      confidence += 0.08; // Good risk/reward
    } else if (avgApyVolRatio >= 1.5) {
      confidence += 0.03; // Acceptable risk/reward
    } else if (avgApyVolRatio < 1.2) {
      confidence -= 0.15; // Poor risk/reward - volatility threatens returns
    }
    
    // Check for pools where volatility risk is too high
    const highVolatilityPools = metrics.filter(m => m.apyVolatilityRatio < 1.5).length;
    if (highVolatilityPools > 0) {
      confidence -= (highVolatilityPools / metrics.length) * 0.1;
    }
    
    // Confidence in timing: how many pools have favorable windows
    const goodTimingPools = metrics.filter(m => m.apyVolatilityRatio >= 2.0 && m.rewardToRiskRatio >= 1.5).length;
    confidence += (goodTimingPools / metrics.length) * 0.05;

    // Decrease confidence if too concentrated
    const maxAlloc = Math.max(...allocations.map(a => a.targetPercentage));
    if (maxAlloc > 50) confidence -= 0.1;

    // Decrease confidence for high-risk pools
    const avgRisk = metrics.reduce((sum, m) => sum + (m.pool.riskScore || 50), 0) / metrics.length;
    confidence -= (avgRisk - 50) / 200; // Up to 0.25 reduction for high risk

    return Math.max(0.3, Math.min(0.95, confidence));
  }

  // Calculate rebalancing cost estimate
  calculateRebalanceCost(
    currentAllocations: Allocation[],
    targetAllocations: Allocation[],
    constraints: OptimizationConstraints
  ): {
    totalCost: number;
    gasCost: number;
    slippageCost: number;
    trades: number;
  } {
    const trades: Array<{ poolId: string; amount: number; direction: 'IN' | 'OUT' }> = [];

    // Find differences
    const allPoolIds = new Set([
      ...currentAllocations.map(a => a.poolId),
      ...targetAllocations.map(a => a.poolId),
    ]);

    for (const poolId of allPoolIds) {
      const current = currentAllocations.find(a => a.poolId === poolId);
      const target = targetAllocations.find(a => a.poolId === poolId);

      const currentValue = current?.currentValue || 0;
      const targetValue = target ? (target.targetPercentage / 100) * 
        (currentAllocations.reduce((sum, a) => sum + a.currentValue, 0) || 100000) : 0;

      const diff = targetValue - currentValue;
      if (Math.abs(diff) > 100) { // Minimum trade size
        trades.push({
          poolId,
          amount: Math.abs(diff),
          direction: diff > 0 ? 'IN' : 'OUT',
        });
      }
    }

    const totalTradeVolume = trades.reduce((sum, t) => sum + t.amount, 0);
    
    // Estimate costs
    const gasPerTrade = (constraints as unknown as { maxGasCostPerTrade?: number }).maxGasCostPerTrade 
      ? ((constraints as unknown as { maxGasCostPerTrade?: number }).maxGasCostPerTrade || 50) * 0.5
      : 25; // Default 25 USD per trade
    const totalGasCost = trades.length * gasPerTrade;
    const slippageCost = totalTradeVolume * 0.002; // 0.2% slippage estimate

    return {
      totalCost: totalGasCost + slippageCost,
      gasCost: totalGasCost,
      slippageCost,
      trades: trades.length,
    };
  }

  // Analyze optimal timing windows for entry/exit based on APY vs volatility
  analyzeTimingWindow(
    pools: Pool[],
    currentPortfolio?: { positions: Array<{ poolId: string; amount: number }>; totalValue: number }
  ): {
    shouldEnter: boolean;
    shouldExit: boolean;
    urgency: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    avgApyVolatilityRatio: number;
    poolsAboveThreshold: number;
    poolsBelowThreshold: number;
    recommendation: string;
    bestPools: Array<{ poolId: string; symbol: string; apy: number; volatility: number; ratio: number }>;
    worstPools: Array<{ poolId: string; symbol: string; apy: number; volatility: number; ratio: number }>;
  } {
    // Calculate metrics for all pools
    const metrics = pools.map(pool => {
      const volatility = pool.volatilityScore || (pool.riskScore || 50) / 5;
      const apyVolatilityRatio = volatility > 0 ? pool.apy / volatility : 999;
      const maxDrawdownEstimate = volatility * 2;
      const rewardToRiskRatio = maxDrawdownEstimate > 0 ? pool.apy / maxDrawdownEstimate : 999;
      
      return {
        pool,
        volatility,
        apyVolatilityRatio,
        maxDrawdownEstimate,
        rewardToRiskRatio,
      };
    });

    // Calculate averages
    const avgApyVolatilityRatio = metrics.reduce((sum, m) => sum + m.apyVolatilityRatio, 0) / metrics.length;
    
    // Threshold analysis
    const poolsAboveThreshold = metrics.filter(m => m.apyVolatilityRatio >= 2.0).length;
    const poolsBelowThreshold = metrics.filter(m => m.apyVolatilityRatio < 1.5).length;
    
    // Best and worst pools
    const sortedByRatio = [...metrics].sort((a, b) => b.apyVolatilityRatio - a.apyVolatilityRatio);
    const bestPools = sortedByRatio.slice(0, 5).map(m => ({
      poolId: m.pool.id,
      symbol: m.pool.symbol,
      apy: m.pool.apy,
      volatility: m.volatility,
      ratio: m.apyVolatilityRatio,
    }));
    
    const worstPools = sortedByRatio.slice(-5).reverse().map(m => ({
      poolId: m.pool.id,
      symbol: m.pool.symbol,
      apy: m.pool.apy,
      volatility: m.volatility,
      ratio: m.apyVolatilityRatio,
    }));

    // Determine if we should enter or exit
    const minEntryRatio = 2.0;  // Need APY to be 2x volatility to enter
    const minHoldRatio = 1.2;   // Can hold if APY is at least 1.2x volatility
    
    let shouldEnter = false;
    let shouldExit = false;
    let urgency: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW';
    let recommendation = '';

    if (avgApyVolatilityRatio >= minEntryRatio) {
      // Good time to enter - APY significantly exceeds volatility
      shouldEnter = true;
      urgency = avgApyVolatilityRatio >= 3.0 ? 'HIGH' : 'MEDIUM';
      recommendation = `Favorable conditions: APY is ${avgApyVolatilityRatio.toFixed(2)}x volatility. Good time to enter or increase positions.`;
    } else if (avgApyVolatilityRatio >= minHoldRatio) {
      // Marginal - can hold but watch closely
      shouldEnter = false;
      shouldExit = false;
      urgency = 'LOW';
      recommendation = `Marginal conditions: APY is ${avgApyVolatilityRatio.toFixed(2)}x volatility. Hold positions but monitor closely.`;
    } else if (avgApyVolatilityRatio >= 1.0) {
      // Warning - volatility approaching APY levels
      shouldExit = poolsBelowThreshold > metrics.length * 0.3; // Exit if >30% of pools are risky
      urgency = 'MEDIUM';
      recommendation = `Warning: APY (${avgApyVolatilityRatio.toFixed(2)}x volatility) is barely covering volatility risk. Consider reducing exposure.`;
    } else {
      // Danger - volatility exceeds APY
      shouldExit = true;
      urgency = 'CRITICAL';
      recommendation = `CRITICAL: Volatility risk (${(1/avgApyVolatilityRatio).toFixed(2)}x) exceeds APY. Exit positions immediately to preserve capital.`;
    }

    // Check current portfolio if provided
    if (currentPortfolio && currentPortfolio.positions.length > 0) {
      const portfolioRiskScore = currentPortfolio.positions.reduce((sum, pos) => {
        const metric = metrics.find(m => m.pool.id === pos.poolId);
        if (metric) {
          const weight = pos.amount / currentPortfolio.totalValue;
          return sum + weight * (1 / metric.apyVolatilityRatio); // Lower ratio = higher risk
        }
        return sum;
      }, 0);

      if (portfolioRiskScore > 0.6) { // High risk concentration
        shouldExit = true;
        urgency = urgency === 'CRITICAL' ? 'CRITICAL' : 'HIGH';
        recommendation += ' Portfolio has high risk concentration. Prioritize exit.';
      }
    }

    logger.info('Timing window analysis', {
      avgApyVolatilityRatio: avgApyVolatilityRatio.toFixed(2),
      shouldEnter,
      shouldExit,
      urgency,
      poolsAboveThreshold,
      poolsBelowThreshold,
    });

    return {
      shouldEnter,
      shouldExit,
      urgency,
      avgApyVolatilityRatio,
      poolsAboveThreshold,
      poolsBelowThreshold,
      recommendation,
      bestPools,
      worstPools,
    };
  }
}

export const optimizationService = new OptimizationService();
