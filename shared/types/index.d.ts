export declare enum YieldMode {
    STABLECOINS = "STABLECOINS",
    BLUECHIPS = "BLUECHIPS",
    LONGTAIL = "LONGTAIL",
    MEMECOINS = "MEMECOINS"
}
export declare enum RiskLevel {
    LOW = "LOW",
    MODERATE = "MODERATE",
    HIGH = "HIGH",
    EXTREME = "EXTREME"
}
export declare enum RebalanceFrequency {
    HOURLY = "HOURLY",
    EVERY_8H = "EVERY_8H",
    EVERY_12H = "EVERY_12H",
    DAILY = "DAILY"
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
    lockingPeriod?: number;
    unlockingPeriod?: number;
    riskScore?: number;
    lastUpdated: Date;
}
export interface APYPrediction {
    currentApy: number;
    predictedMinApy: number;
    predictedMaxApy?: number;
    confidence: 'LOW' | 'MEDIUM' | 'HIGH';
    timeframe: string;
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
}
export interface Position {
    id: string;
    poolId: string;
    pool: Pool;
    amount: number;
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
}
export interface Allocation {
    poolId: string;
    targetPercentage: number;
    actualPercentage: number;
    currentValue: number;
    deviation: number;
}
export interface PortfolioSettings {
    initialCapital: number;
    mode: YieldMode;
    rebalanceFrequency: RebalanceFrequency;
    minRebalanceThreshold: number;
    maxSlippage: number;
    maxGasCostPerTrade: number;
    riskTriggers: RiskTrigger[];
    telegramNotifications: boolean;
    paperTrading: boolean;
    maxPoolConcentration: number;
    minPoolTvl: number;
    apyThreshold: number;
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
    feesPaid: number;
    slippageCosts: number;
    gasCosts: number;
    profitFactor: number;
    winRate: number;
    averageHoldingPeriod: number;
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
    gasCost: number;
    bridgeCost: number;
    swapCost: number;
    protocolFees: number;
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
    maxConcentration: number;
    totalRiskBudget: number;
    maxLockingPeriod: number;
    minApy: number;
    excludedPools: string[];
    requiredChains?: string[];
    maxGasPerRebalance: number;
}
export interface OptimizationObjectives {
    maximize: 'APY' | 'RISK_ADJUSTED_RETURN' | 'SORTINO_RATIO' | 'CUSTOM';
    riskAversion: number;
    timeHorizon: number;
    rebalanceFrequency: RebalanceFrequency;
}
export interface OptimizationResult {
    allocations: Allocation[];
    expectedReturn: number;
    expectedRisk: number;
    expectedSortinoRatio: number;
    confidence: number;
    scenarioAnalysis: ScenarioResult[];
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
    defaultRebalanceFrequency: RebalanceFrequency;
    minRebalanceInterval: number;
    riskCheckInterval: number;
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
//# sourceMappingURL=index.d.ts.map