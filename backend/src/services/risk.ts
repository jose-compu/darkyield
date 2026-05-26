import { 
  Position, 
  Pool, 
  RiskTrigger, 
  RiskAlertEvent, 
  RiskLevel,
  RebalanceAction,
  Portfolio,
  type PortfolioPositionRiskRow,
} from '../../../shared/types/index.js';
import { defiLlamaService } from './defillama.js';
import { logger, logRiskAlert } from '../utils/logger.js';
import { asTimeMs } from '../utils/dates.js';

/** Numerical decomposition for one position (serialized into API `PortfolioPositionRiskRow`). */
export interface PositionRiskScoreDetail {
  poolHeuristicScore: number;
  triggerContribution: number;
  sumBeforeCap: number;
  cappedAt100: boolean;
  dataSource: 'live_pool' | 'embedded_snapshot' | 'unavailable';
  triggerRows: Array<{
    type: string;
    threshold: number;
    triggered: boolean;
    measuredValue: number;
    pointsAdded: number;
    message: string;
  }>;
}

interface RiskAssessment {
  level: RiskLevel;
  score: number;
  triggers: RiskTriggerResult[];
  recommendations: string[];
  positionRisks?: Map<string, RiskAssessment>;
  scoreDetail?: PositionRiskScoreDetail;
  breakdown?: {
    positionRiskWeightedAvg: number;
    positionRiskMax: number;
    concentrationPoints: number;
    correlationPoints: number;
    notes: string[];
    formulaNote?: string;
  };
}

interface RiskTriggerResult {
  trigger: RiskTrigger;
  triggered: boolean;
  value: number;
  message: string;
}

interface PoolRiskMetrics {
  tvlTrend: number; // percentage change
  apyTrend: number; // percentage change
  volatility: number;
  ilRisk: number;
  protocolRisk: number;
}

export class RiskService {
  private lastTriggerTime: Map<string, number> = new Map(); // triggerId -> timestamp

  // Assess risk for a single position
  async assessPosition(
    position: Position,
    triggers: RiskTrigger[]
): Promise<RiskAssessment> {
    let usedEmbeddedSnapshot = false;
    let pool = await defiLlamaService.getPool(position.poolId, position.pool);
    if (!pool && position.pool) {
      usedEmbeddedSnapshot = true;
      pool = {
        ...position.pool,
        riskScore:
          position.pool.riskScore ?? defiLlamaService.estimateRiskScoreFromSnapshot(position.pool),
      };
    }
    if (!pool) {
      return {
        level: RiskLevel.HIGH,
        score: 80,
        triggers: [],
        recommendations: ['Unable to fetch pool data - high uncertainty risk'],
        scoreDetail: {
          poolHeuristicScore: 80,
          triggerContribution: 0,
          sumBeforeCap: 80,
          cappedAt100: false,
          dataSource: 'unavailable',
          triggerRows: [],
        },
      };
    }

    const triggerResults: RiskTriggerResult[] = [];
    const triggeredTriggers: RiskTrigger[] = [];

    for (const trigger of triggers) {
      const result = this.evaluateTrigger(trigger, position, pool);
      triggerResults.push(result);
      
      if (result.triggered) {
        // Check cooldown
        const triggerId = `${position.id}-${trigger.type}`;
        const lastTriggered = this.lastTriggerTime.get(triggerId) || 0;
        const cooldownMs = trigger.cooldownMinutes * 60 * 1000;
        
        if (Date.now() - lastTriggered > cooldownMs) {
          triggeredTriggers.push(trigger);
          this.lastTriggerTime.set(triggerId, Date.now());
          
          logRiskAlert(trigger.action, trigger.type, result.message);
        }
      }
    }

    const { score: riskScore, detail: scoreDetail } = this.calculateRiskScoreDetailed(
      triggerResults,
      pool
    );
    scoreDetail.dataSource = usedEmbeddedSnapshot ? 'embedded_snapshot' : 'live_pool';
    const riskLevel = this.scoreToLevel(riskScore);

    // Generate recommendations
    const recommendations = this.generateRecommendations(
      triggeredTriggers, 
      position, 
      pool,
      riskScore
    );

    return {
      level: riskLevel,
      score: riskScore,
      triggers: triggerResults,
      recommendations,
      scoreDetail,
    };
  }

  // Assess risk for entire portfolio
  async assessPortfolio(
    portfolio: Portfolio
  ): Promise<RiskAssessment & { positionRisks: Map<string, RiskAssessment> }> {
    const positionRisks = new Map<string, RiskAssessment>();
    let maxRiskScore = 0;
    let weightedRiskSum = 0;
    let deployedValue = 0;
    const allTriggeredTriggers: RiskTrigger[] = [];
    const allRecommendations: string[] = [];

    // Assess each position
    for (const position of portfolio.positions) {
      if (position.status !== 'ACTIVE') continue;

      const assessment = await this.assessPosition(position, portfolio.settings.riskTriggers);
      positionRisks.set(position.id, assessment);

      if (assessment.score > maxRiskScore) {
        maxRiskScore = assessment.score;
      }

      const notionals = position.amount + position.unrealizedPnl;
      const value = notionals > 0 ? notionals : 0;
      weightedRiskSum += value * assessment.score;
      deployedValue += value;

      // Collect unique triggers
      for (const trigger of assessment.triggers) {
        if (trigger.triggered) {
          const existing = allTriggeredTriggers.find(t => t.type === trigger.trigger.type);
          if (!existing) {
            allTriggeredTriggers.push(trigger.trigger);
          }
        }
      }

      // Collect recommendations
      allRecommendations.push(...assessment.recommendations);
    }

    // Calculate portfolio-level risk factors
    const conc = this.measureConcentration(portfolio);
    const concentrationRisk = conc.excessPoints;
    const correlationRisk = await this.calculateCorrelationRisk(portfolio);

    const weightedPositionRisk =
      deployedValue > 0 ? weightedRiskSum / deployedValue : 0;

    // Adjust overall score: diversified books get credit vs. a single worst pool dominating
    const adjustedScore = Math.min(
      100,
      weightedPositionRisk + concentrationRisk + correlationRisk
    );
    const riskLevel = this.scoreToLevel(adjustedScore);

    // Portfolio-level recommendations
    if (concentrationRisk > 10) {
      allRecommendations.push(`High concentration risk detected (${concentrationRisk.toFixed(1)}%). Consider diversifying.`);
    }
    if (correlationRisk > 5) {
      allRecommendations.push('Positions show high correlation. Consider assets with different risk drivers.');
    }

    const notes: string[] = [];
    notes.push(
      `Position risk (USD-weighted average): ${weightedPositionRisk.toFixed(1)} / 100. Worst single position: ${maxRiskScore.toFixed(1)} / 100.`
    );
    if (concentrationRisk > 0.05) {
      notes.push(
        `Concentration: ~${conc.largestSharePercent.toFixed(0)}% of portfolio in one pool (limit ${conc.maxAllowed}%) adds +${concentrationRisk.toFixed(1)}.`
      );
    }
    if (correlationRisk > 0.05) {
      notes.push(`Overlapping chain/protocol exposure adds +${correlationRisk.toFixed(1)}.`);
    }
    if (portfolio.positions.filter((p) => p.status === 'ACTIVE').length === 0) {
      notes.push('No open positions; score reflects portfolio structure only.');
    }

    const formulaNote = `Portfolio score = min(100, weightedAvg(position scores) + concentration + correlation) = min(100, ${weightedPositionRisk.toFixed(2)} + ${concentrationRisk.toFixed(2)} + ${correlationRisk.toFixed(2)}) = ${adjustedScore.toFixed(2)}.`;

    return {
      level: riskLevel,
      score: adjustedScore,
      triggers: [], // Portfolio-level triggers would go here
      recommendations: [...new Set(allRecommendations)], // Remove duplicates
      positionRisks,
      breakdown: {
        positionRiskWeightedAvg: weightedPositionRisk,
        positionRiskMax: maxRiskScore,
        concentrationPoints: concentrationRisk,
        correlationPoints: correlationRisk,
        notes,
        formulaNote,
      },
    };
  }

  /** Maps live assessment to API rows for `riskSummary.positionRiskRows`. */
  static toPositionRiskRows(
    portfolio: Portfolio,
    positionRisks: Map<string, RiskAssessment>
  ): PortfolioPositionRiskRow[] {
    const rows: PortfolioPositionRiskRow[] = [];
    for (const pos of portfolio.positions) {
      if (pos.status !== 'ACTIVE') continue;
      const a = positionRisks.get(pos.id);
      if (!a?.scoreDetail) continue;
      const d = a.scoreDetail;
      rows.push({
        positionId: pos.id,
        poolId: pos.poolId,
        symbol: pos.pool.symbol,
        project: pos.pool.project,
        chain: pos.pool.chain,
        score: a.score,
        level: a.level,
        poolHeuristicScore: d.poolHeuristicScore,
        triggerContribution: d.triggerContribution,
        sumBeforeCap: d.sumBeforeCap,
        cappedAt100: d.cappedAt100,
        dataSource: d.dataSource,
        triggers: d.triggerRows.map((t) => ({
          type: t.type,
          threshold: t.threshold,
          triggered: t.triggered,
          measuredValue: t.measuredValue,
          pointsAdded: t.pointsAdded,
          message: t.message,
        })),
      });
    }
    return rows;
  }

  // Generate rebalance actions based on risk assessment
  generateRiskActions(
    assessment: RiskAssessment,
    portfolio: Portfolio
  ): RebalanceAction[] {
    const actions: RebalanceAction[] = [];

    for (const position of portfolio.positions) {
      if (position.status !== 'ACTIVE') continue;

      const positionRisk = assessment.positionRisks?.get(position.id);
      if (!positionRisk) continue;

      for (const triggerResult of positionRisk.triggers) {
        if (!triggerResult.triggered) continue;

        const action = triggerResult.trigger.action;
        let rebalanceAction: RebalanceAction | null = null;

        switch (action) {
          case 'EXIT':
            rebalanceAction = {
              type: 'EXIT',
              poolId: position.poolId,
              currentAmount: position.amount,
              targetAmount: 0,
              delta: -position.amount,
              reason: `Risk trigger: ${triggerResult.trigger.type} - ${triggerResult.message}`,
              expectedApy: 0,
              expectedFees: position.amount * 0.005, // Estimate exit fees
              confidence: 0.9,
            };
            break;

          case 'REDUCE':
            const reductionAmount = position.amount * 0.5; // Reduce by 50%
            rebalanceAction = {
              type: 'REALLOCATE',
              poolId: position.poolId,
              currentAmount: position.amount,
              targetAmount: position.amount - reductionAmount,
              delta: -reductionAmount,
              reason: `Risk trigger: ${triggerResult.trigger.type} - ${triggerResult.message}`,
              expectedApy: position.currentApy * 0.7, // Assume some APY reduction
              expectedFees: reductionAmount * 0.003,
              confidence: 0.8,
            };
            break;

          case 'HEDGE':
            // For hedging, we'd need additional logic for options/perps
            // For now, recommend reducing exposure
            rebalanceAction = {
              type: 'HOLD',
              poolId: position.poolId,
              reason: `Risk trigger: ${triggerResult.trigger.type} - Hedging recommended`,
              expectedApy: position.currentApy,
              expectedFees: 0,
              confidence: 0.6,
              delta: 0,
            };
            break;

          case 'ALERT':
          default:
            // No action needed, just logged
            break;
        }

        if (rebalanceAction) {
          actions.push(rebalanceAction);
        }
      }
    }

    return actions;
  }

  // Evaluate a single risk trigger
  private evaluateTrigger(
    trigger: RiskTrigger,
    position: Position,
    pool: Pool
  ): RiskTriggerResult {
    let triggered = false;
    let value = 0;
    let message = '';

    switch (trigger.type) {
      case 'TVL_DROP': {
        if (pool.tvlTrend7d !== undefined) {
          value = -pool.tvlTrend7d; // Negative trend = TVL dropping
          triggered = value > trigger.threshold;
          if (triggered) {
            message = `TVL dropped ${value.toFixed(2)}% in 7 days (threshold: ${trigger.threshold}%)`;
          }
        }
        break;
      }

      case 'APY_DROP': {
        const apyDropPercent = ((position.entryApy - pool.apy) / position.entryApy) * 100;
        value = apyDropPercent;
        triggered = apyDropPercent > trigger.threshold;
        if (triggered) {
          message = `APY dropped ${apyDropPercent.toFixed(2)}% from entry (${position.entryApy.toFixed(2)}% → ${pool.apy.toFixed(2)}%)`;
        }
        break;
      }

      case 'VOLATILITY_SPIKE': {
        if (pool.volatilityScore !== undefined) {
          // Compare to baseline (assume 5% is normal for stablecoin yields)
          const baselineVolatility = 5;
          value = (pool.volatilityScore / baselineVolatility) * 100;
          triggered = value > trigger.threshold * 100;
          if (triggered) {
            message = `Volatility is ${(pool.volatilityScore / baselineVolatility).toFixed(2)}x normal levels`;
          }
        }
        break;
      }

      case 'MAX_DRAWDOWN': {
        // Calculate position drawdown from peak
        const holdingPeriod = (Date.now() - asTimeMs(position.entryTimestamp)) / (1000 * 60 * 60 * 24);
        const expectedValue = position.amount * (1 + (position.entryApy / 100) * (holdingPeriod / 365));
        const currentValue = position.amount + position.unrealizedPnl;
        const drawdown = ((expectedValue - currentValue) / expectedValue) * 100;
        
        value = Math.max(0, drawdown);
        triggered = drawdown > trigger.threshold;
        if (triggered) {
          message = `Position drawdown of ${drawdown.toFixed(2)}% from expected value`;
        }
        break;
      }

      case 'IL_RISK_INCREASE': {
        // Check if pool has become more risky
        if (pool.ilRisk === 'high' || pool.ilRisk === 'yes') {
          value = 100;
          triggered = true;
          message = `Pool shows high impermanent loss risk: ${pool.ilRisk}`;
        }
        break;
      }
    }

    return {
      trigger,
      triggered,
      value,
      message,
    };
  }

  /**
   * Pool heuristic (DefiLlama `riskScore` or 50) plus +10 per triggered rule,
   * +10 more if measured value &gt; 2× threshold; then min(100, sum).
   */
  private calculateRiskScoreDetailed(
    triggerResults: RiskTriggerResult[],
    pool: Pool
  ): { score: number; detail: PositionRiskScoreDetail } {
    const poolHeuristic = pool.riskScore ?? 50;
    let score = poolHeuristic;
    let triggerContribution = 0;
    const triggerRows: PositionRiskScoreDetail['triggerRows'] = [];

    for (const result of triggerResults) {
      const base = result.triggered ? 10 : 0;
      const severe =
        result.triggered && result.value > result.trigger.threshold * 2 ? 10 : 0;
      const pointsAdded = base + severe;
      if (result.triggered) {
        triggerContribution += pointsAdded;
        score += pointsAdded;
      }
      triggerRows.push({
        type: result.trigger.type,
        threshold: result.trigger.threshold,
        triggered: result.triggered,
        measuredValue: result.value,
        pointsAdded,
        message: result.message,
      });
    }

    const sumBeforeCap = score;
    const finalScore = Math.min(100, score);
    return {
      score: finalScore,
      detail: {
        poolHeuristicScore: poolHeuristic,
        triggerContribution,
        sumBeforeCap,
        cappedAt100: sumBeforeCap > 100,
        dataSource: 'live_pool',
        triggerRows,
      },
    };
  }

  // Convert score to risk level
  private scoreToLevel(score: number): RiskLevel {
    if (score < 30) return RiskLevel.LOW;
    if (score < 55) return RiskLevel.MODERATE;
    if (score < 80) return RiskLevel.HIGH;
    return RiskLevel.EXTREME;
  }

  /** Single-pool weight vs settings.maxPoolConcentration → extra score points + display context. */
  private measureConcentration(portfolio: Portfolio): {
    excessPoints: number;
    largestSharePercent: number;
    maxAllowed: number;
  } {
    const totalValue = portfolio.totalValue;
    const maxAllowed = portfolio.settings.maxPoolConcentration;
    if (totalValue === 0) {
      return { excessPoints: 0, largestSharePercent: 0, maxAllowed };
    }

    let maxPosition = 0;
    for (const position of portfolio.positions) {
      if (position.status === 'ACTIVE') {
        const value = position.amount + position.unrealizedPnl;
        if (value > maxPosition) {
          maxPosition = value;
        }
      }
    }

    const largestSharePercent = (maxPosition / totalValue) * 100;

    if (largestSharePercent <= maxAllowed) {
      return { excessPoints: 0, largestSharePercent, maxAllowed };
    }

    return {
      excessPoints: (largestSharePercent - maxAllowed) * 0.5,
      largestSharePercent,
      maxAllowed,
    };
  }

  private calculateConcentrationRisk(portfolio: Portfolio): number {
    return this.measureConcentration(portfolio).excessPoints;
  }

  // Calculate correlation risk (how similar positions are)
  private async calculateCorrelationRisk(portfolio: Portfolio): Promise<number> {
    if (portfolio.positions.length < 2) return 0;

    const activePositions = portfolio.positions.filter(p => p.status === 'ACTIVE');
    if (activePositions.length < 2) return 0;

    // Check for same chain concentration
    const chainCounts = new Map<string, number>();
    for (const position of activePositions) {
      const chain = position.pool.chain;
      chainCounts.set(chain, (chainCounts.get(chain) || 0) + 1);
    }

    // Check for same protocol concentration
    const protocolCounts = new Map<string, number>();
    for (const position of activePositions) {
      const protocol = position.pool.project;
      protocolCounts.set(protocol, (protocolCounts.get(protocol) || 0) + 1);
    }

    let correlationRisk = 0;

    // Penalize same-chain concentration
    for (const [chain, count] of chainCounts) {
      const chainPercentage = (count / activePositions.length) * 100;
      if (chainPercentage > 60) {
        correlationRisk += (chainPercentage - 60) * 0.3;
      }
    }

    // Penalize same-protocol concentration
    for (const [protocol, count] of protocolCounts) {
      const protocolPercentage = (count / activePositions.length) * 100;
      if (protocolPercentage > 50) {
        correlationRisk += (protocolPercentage - 50) * 0.4;
      }
    }

    return Math.min(30, correlationRisk); // Cap at 30
  }

  // Generate recommendations based on triggers
  private generateRecommendations(
    triggers: RiskTrigger[],
    position: Position,
    pool: Pool,
    riskScore: number
  ): string[] {
    const recommendations: string[] = [];

    if (triggers.length === 0 && riskScore < 50) {
      recommendations.push('Risk levels acceptable. Continue monitoring.');
      return recommendations;
    }

    for (const trigger of triggers) {
      switch (trigger.action) {
        case 'EXIT':
          recommendations.push(`URGENT: Consider exiting position in ${pool.symbol} (${pool.project}) due to ${trigger.type}`);
          break;
        case 'REDUCE':
          recommendations.push(`Consider reducing position in ${pool.symbol} (${pool.project}) by 50%`);
          break;
        case 'HEDGE':
          recommendations.push(`Consider hedging position in ${pool.symbol} with options or perps`);
          break;
        case 'ALERT':
          recommendations.push(`Monitor ${pool.symbol} (${pool.project}) closely - ${trigger.type} threshold reached`);
          break;
      }
    }

    // General recommendations based on score
    if (riskScore > 80) {
      recommendations.push('CRITICAL: Multiple risk factors present. Consider emergency exit procedures.');
    } else if (riskScore > 60) {
      recommendations.push('HIGH RISK: Review position sizing and consider defensive moves.');
    }

    return recommendations;
  }

  // Create risk alert event for WebSocket/Notifications
  createRiskAlertEvent(
    portfolioId: string,
    assessment: RiskAssessment,
    affectedPositions: Position[]
  ): RiskAlertEvent {
    return {
      type: 'RISK_ALERT',
      timestamp: new Date(),
      payload: {
        level: assessment.level,
        trigger: assessment.triggers.find(t => t.triggered)?.trigger || {
          type: 'MAX_DRAWDOWN',
          threshold: 0,
          action: 'ALERT',
          cooldownMinutes: 0,
        },
        affectedPositions: affectedPositions.map(p => p.id),
        message: assessment.recommendations.join('. '),
        recommendedAction: assessment.recommendations[0] || 'Monitor and review',
      },
    };
  }
}

export const riskService = new RiskService();
