// DarkYield Shared Types

export enum YieldMode {
  STABLE_BLUECHIPS = 'STABLE_BLUECHIPS', // Hybrid: Stablecoins + BlueChips (Default)
  STABLECOINS = 'STABLECOINS',
  BLUECHIPS = 'BLUECHIPS',
  LONGTAIL = 'LONGTAIL',
  MEMECOINS = 'MEMECOINS',
}

export enum RiskLevel {
  LOW = 'LOW',
  MODERATE = 'MODERATE',
  HIGH = 'HIGH',
  EXTREME = 'EXTREME',
}

export enum RebalanceFrequency {
  HOURLY = 'HOURLY',
  EVERY_8H = 'EVERY_8H',
  EVERY_12H = 'EVERY_12H',
  DAILY = 'DAILY',
}

export interface Pool {
  id: string;
  chain: string;
  project: string;
  symbol: string;
  tvlUsd: number;
  apyBase: number;
  apyReward: number;
  apy: number;
  apyBase7d?: number;
  apyMean30d?: number;
  stablecoin: boolean;
  ilRisk: 'yes' | 'no' | 'medium' | 'high';
  exposure: 'single' | 'multi';
  underlyingTokens?: string[];
  rewardTokens?: string[];
  poolMeta?: string;
  url?: string;
  apyPrediction?: APYPrediction;
  volatilityScore?: number;
  tvlTrend7d?: number;
  tvlTrend30d?: number;
  apyTrend7d?: number;
  apyTrend30d?: number;
  sortinoRatio?: number;
  maxDrawdown?: number;
  lockingPeriod?: number; // in days
  unlockingPeriod?: number; // in days
  riskScore?: number;
  /** True when total yield (APY) is effectively zero — pool may still have TVL but no current incentives */
  inactive?: boolean;
  /**
   * Reported APY exceeds the active sanity ceiling (stale/broken metrics, e.g. closed Morpho vaults).
   * Omitted when within threshold.
   */
  apyOutlier?: boolean;
  lastUpdated: Date;
}

export interface APYPrediction {
  currentApy: number;
  predictedMinApy: number;
  predictedMaxApy?: number;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  timeframe: string; // e.g., "4 weeks"
  expiresAt: Date;
}

export interface Chain {
  id: string;
  name: string;
  tokenSymbol: string;
  geckoId?: string;
  tvl?: number;
  tokenPrice?: number;
  bridgeRisk?: RiskLevel;
}

export interface Protocol {
  id: string;
  name: string;
  url?: string;
  logo?: string;
  tvl?: number;
  chains: string[];
  category?: string;
  riskLevel?: RiskLevel;
}

export interface YieldFilter {
  mode: YieldMode;
  minTvl?: number;
  maxTvl?: number;
  minApy?: number;
  maxApy?: number;
  chains?: string[];
  excludeProtocols?: string[];
  stablecoinsOnly?: boolean;
  excludeILRisk?: boolean;
  maxRiskLevel?: RiskLevel;
  minSortinoRatio?: number;
  requireApyPrediction?: boolean;
  excludeLocking?: boolean;
  /** When false (default), pools with inactive yields are omitted */
  includeInactive?: boolean;
  /**
   * Hide pools with APY above this percent (DefiLlama can show absurd APY when deposits are closed).
   * Defaults to server `POOL_MAX_APY_PERCENT`.
   */
  maxReasonableApyPercent?: number;
  /** When true, include pools above the APY ceiling (still flagged `apyOutlier`). */
  includeApyOutliers?: boolean;
}

export interface Position {
  id: string;
  poolId: string;
  pool: Pool;
  amount: number; // in USD
  tokenAmounts: Record<string, number>;
  entryApy: number;
  currentApy: number;
  entryTimestamp: Date;
  lastRebalancedAt?: Date;
  unrealizedPnl: number;
  realizedPnl: number;
  feesPaid: number;
  status: 'ACTIVE' | 'EXITING' | 'CLOSED';
  exitTimestamp?: Date;
  exitReason?: string;
}

/** One configured trigger evaluated against a pool/position (numerical risk model). */
export interface PortfolioPositionRiskTriggerRow {
  type: string;
  threshold: number;
  triggered: boolean;
  measuredValue: number;
  /** Points added to the pool heuristic for this trigger (+10 base, +10 severity when over 2× threshold). */
  pointsAdded: number;
  message: string;
}

/** Per open position: DefiLlama-style pool heuristic plus trigger points → capped score. */
export interface PortfolioPositionRiskRow {
  positionId: string;
  poolId: string;
  symbol: string;
  project: string;
  chain: string;
  score: number;
  level: RiskLevel;
  /** Base 0–100 from DefiLlama pool heuristics (TVL, IL, sigma, outlier, …), or 50 if missing. */
  poolHeuristicScore: number;
  /** Total points added by triggered risk rules (before portfolio cap). */
  triggerContribution: number;
  /** poolHeuristic + triggerContribution before min(100, …). */
  sumBeforeCap: number;
  cappedAt100: boolean;
  dataSource: 'live_pool' | 'embedded_snapshot' | 'unavailable';
  triggers: PortfolioPositionRiskTriggerRow[];
}

/**
 * Structural risk (positions, pools, concentration, correlation) from RiskService.
 * Populated on API responses; not persisted with the portfolio document.
 */
export interface PortfolioRiskSummary {
  score: number;
  level: RiskLevel;
  /** Why the score is what it is (concentration vs pool/trigger risk, etc.) */
  breakdown?: {
    /** USD-weighted mean of active position risk scores (drives headline portfolio score). */
    positionRiskWeightedAvg: number;
    /** Highest single-position risk (worst leg), for transparency. */
    positionRiskMax: number;
    concentrationPoints: number;
    correlationPoints: number;
    notes: string[];
    /** Portfolio formula: min(100, weightedAvg(position scores) + concentration + correlation). */
    formulaNote?: string;
  };
  /** One row per active position with numerical decomposition. */
  positionRiskRows?: PortfolioPositionRiskRow[];
}

export interface Portfolio {
  id: string;
  mode: YieldMode;
  totalValue: number;
  availableCash: number;
  positions: Position[];
  targetAllocation: Allocation[];
  actualAllocation: Allocation[];
  performanceMetrics: PerformanceMetrics;
  createdAt: Date;
  updatedAt: Date;
  settings: PortfolioSettings;
  /** Present when returned from GET /api/portfolios and GET /api/portfolios/:id */
  riskSummary?: PortfolioRiskSummary;
}

export interface Allocation {
  poolId: string;
  targetPercentage: number;
  actualPercentage: number;
  currentValue: number;
  deviation: number; // percentage points from target
  // APY decay/time-based fields
  recommendedHoldTime?: number; // days to hold for max profit
  deadlineToExit?: Date; // when position becomes unprofitable
  projectedApySeries?: Array<{ day: number; projectedApy: number }>; // 30-day APY projection
  apyDecayRate?: number; // daily APY change rate
  totalReturnEstimate?: number; // expected total return over hold period
  maxProfitDay?: number; // day when cumulative profit peaks
}

export interface PortfolioSettings {
  initialCapital: number;
  mode: YieldMode;
  rebalanceFrequency: RebalanceFrequency;
  minRebalanceThreshold: number; // minimum deviation % to trigger rebalance
  maxSlippage: number; // maximum allowed slippage %
  maxGasCostPerTrade: number; // in USD
  riskTriggers: RiskTrigger[];
  telegramNotifications: boolean;
  paperTrading: boolean;
  maxPoolConcentration: number; // max % in single pool
  minPoolTvl: number;
  apyThreshold: number; // minimum APY to consider
}

export interface RiskTrigger {
  type: 'TVL_DROP' | 'APY_DROP' | 'VOLATILITY_SPIKE' | 'IL_RISK_INCREASE' | 'MAX_DRAWDOWN';
  threshold: number;
  action: 'ALERT' | 'REDUCE' | 'EXIT' | 'HEDGE';
  cooldownMinutes: number;
}

export interface PerformanceMetrics {
  totalReturn: number;
  dailyReturn: number;
  weeklyReturn: number;
  monthlyReturn: number;
  annualizedApy: number;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdown: number;
  volatility: number;
  /** Weighted by deployed capital from current APYs and pool volatility (open positions). */
  expectedApy: number;
  expectedVolatility: number;
  expectedSortinoRatio: number;
  feesPaid: number;
  slippageCosts: number;
  gasCosts: number;
  profitFactor: number;
  winRate: number;
  averageHoldingPeriod: number; // in hours
  rebalanceCount: number;
}

export interface RebalanceAction {
  type: 'ENTER' | 'EXIT' | 'REALLOCATE' | 'HOLD';
  poolId: string;
  currentAmount?: number;
  targetAmount?: number;
  delta: number;
  reason: string;
  expectedApy: number;
  expectedFees: number;
  confidence: number;
}

export interface RebalancePlan {
  id: string;
  timestamp: Date;
  actions: RebalanceAction[];
  expectedReturn: number;
  totalFees: number;
  riskScore: number;
  executionTime?: Date;
  status: 'PENDING' | 'EXECUTING' | 'COMPLETED' | 'FAILED';
  error?: string;
}

export interface FeeEstimate {
  gasCost: number; // in USD
  bridgeCost: number; // in USD
  swapCost: number; // in USD
  protocolFees: number; // in USD
  total: number;
}

export interface OptimizationInput {
  pools: Pool[];
  availableCapital: number;
  constraints: OptimizationConstraints;
  objectives: OptimizationObjectives;
  historicalData?: HistoricalDataPoint[];
}

export interface OptimizationConstraints {
  maxPools: number;
  minPoolTvl: number;
  maxConcentration: number; // max % in single pool
  totalRiskBudget: number;
  maxLockingPeriod: number; // in days
  minApy: number;
  excludedPools: string[];
  requiredChains?: string[];
  maxGasPerRebalance: number;
}

export interface OptimizationObjectives {
  maximize: 'APY' | 'RISK_ADJUSTED_RETURN' | 'SORTINO_RATIO' | 'CUSTOM';
  riskAversion: number; // 0-1, higher = more conservative
  timeHorizon: number; // in days
  rebalanceFrequency: RebalanceFrequency;
}

export interface OptimizationResult {
  allocations: Allocation[];
  expectedReturn: number;
  expectedRisk: number;
  expectedSortinoRatio: number;
  confidence: number;
  scenarioAnalysis: ScenarioResult[];
  // APY decay/time-based analysis
  poolDecayMetrics?: Array<{
    poolId: string;
    symbol: string;
    apyDecayRate: number; // daily change rate
    apyHalfLife: number; // days to double/halve
    optimalHoldTime: number; // recommended days
    deadlineToExit?: Date;
    projectedApySeries: Array<{ day: number; projectedApy: number }>;
    maxProfitDay: number;
    totalReturnEstimate: number;
    recommendation: string; // e.g., "Hold for 3 days then exit"
  }>;
  overallRecommendation?: string; // Portfolio-level time strategy
  averageHoldTime?: number; // Average recommended hold across all allocations
}

export interface ScenarioResult {
  name: string;
  probability: number;
  expectedReturn: number;
  maxLoss: number;
  description: string;
}

export interface HistoricalDataPoint {
  timestamp: Date;
  poolId: string;
  apy: number;
  tvl: number;
}

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  notifications: {
    rebalance: boolean;
    riskAlert: boolean;
    performance: boolean;
    dailySummary: boolean;
    error: boolean;
  };
}

export interface SystemConfig {
  defiLlamaApiUrl: string;
  /** `evm_only` (default): only EVM-compatible chains. `all`: include Solana and other networks. */
  poolChainFilterMode?: 'evm_only' | 'all';
  /** APY (%) above this is treated as an unreliable outlier unless `includeApyOutliers`. Default 1000. */
  poolMaxApyPercent: number;
  /** Hard cap for client-supplied `maxReasonableApyPercent` (API safety). */
  poolMaxApyPercentHardCap: number;
  defaultRebalanceFrequency: RebalanceFrequency;
  minRebalanceInterval: number; // in minutes
  riskCheckInterval: number; // in minutes
  paperTrading: boolean;
  maxConcurrentPositions: number;
  defaultRiskTriggers: RiskTrigger[];
  telegram?: TelegramConfig;
  rpcEndpoints: Record<string, string>;
  walletConfig?: {
    address: string;
    encryptedKey?: string;
  };
}

// WebSocket Events
export interface WSEvent {
  type: string;
  timestamp: Date;
  payload: unknown;
}

export interface PoolUpdateEvent extends WSEvent {
  type: 'POOL_UPDATE';
  payload: {
    poolId: string;
    changes: Partial<Pool>;
    previousValues: Partial<Pool>;
  };
}

export interface PositionUpdateEvent extends WSEvent {
  type: 'POSITION_UPDATE';
  payload: {
    positionId: string;
    portfolioId: string;
    changes: Partial<Position>;
    unrealizedPnl: number;
  };
}

export interface RebalanceEvent extends WSEvent {
  type: 'REBALANCE_START' | 'REBALANCE_COMPLETE' | 'REBALANCE_FAILED';
  payload: {
    planId: string;
    portfolioId: string;
    actions?: RebalanceAction[];
    metrics?: PerformanceMetrics;
    error?: string;
  };
}

export interface RiskAlertEvent extends WSEvent {
  type: 'RISK_ALERT';
  payload: {
    level: RiskLevel;
    trigger: RiskTrigger;
    affectedPositions: string[];
    message: string;
    recommendedAction: string;
  };
}
