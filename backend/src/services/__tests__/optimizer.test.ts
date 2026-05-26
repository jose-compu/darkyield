import { OptimizationService } from '../optimizer.js';
import { YieldMode, RebalanceFrequency } from '../../../../shared/types/index.js';

describe('OptimizationService', () => {
  let service: OptimizationService;

  beforeEach(() => {
    service = new OptimizationService();
  });

  const createMockPool = (overrides = {}) => ({
    id: 'test-pool-1',
    chain: 'Ethereum',
    project: 'aave',
    symbol: 'USDC',
    tvlUsd: 100000000,
    apyBase: 5.0,
    apyReward: 0,
    apy: 5.0,
    apyBase7d: 4.8,
    apyMean30d: 4.9,
    stablecoin: true,
    ilRisk: 'no' as const,
    exposure: 'single' as const,
    riskScore: 30,
    volatilityScore: 2.5,
    lockingPeriod: 0,
    lastUpdated: new Date(),
    ...overrides,
  });

  describe('optimize', () => {
    it('should return optimized allocations for max APY', async () => {
      const pools = [
        createMockPool({ id: 'pool-1', apy: 5.0, tvlUsd: 100000000 }),
        createMockPool({ id: 'pool-2', apy: 3.0, tvlUsd: 50000000 }),
        createMockPool({ id: 'pool-3', apy: 7.0, tvlUsd: 20000000 }),
      ];

      const input = {
        pools,
        availableCapital: 10000,
        constraints: {
          maxPools: 3,
          minPoolTvl: 1000000,
          maxConcentration: 0.5,
          totalRiskBudget: 70,
          maxLockingPeriod: 7,
          minApy: 1,
          excludedPools: [],
          maxGasPerRebalance: 50,
        },
        objectives: {
          maximize: 'APY' as const,
          riskAversion: 0.5,
          timeHorizon: 7,
          rebalanceFrequency: RebalanceFrequency.DAILY,
        },
      };

      const result = await service.optimize(input);

      expect(result.allocations).toBeDefined();
      expect(result.allocations.length).toBeGreaterThan(0);
      expect(result.expectedReturn).toBeGreaterThan(0);
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it('should return optimized allocations for risk-adjusted return', async () => {
      const pools = [
        createMockPool({ id: 'pool-1', apy: 5.0, riskScore: 30, tvlUsd: 100000000 }),
        createMockPool({ id: 'pool-2', apy: 8.0, riskScore: 70, tvlUsd: 5000000 }),
        createMockPool({ id: 'pool-3', apy: 4.0, riskScore: 20, tvlUsd: 50000000 }),
      ];

      const input = {
        pools,
        availableCapital: 10000,
        constraints: {
          maxPools: 3,
          minPoolTvl: 1000000,
          maxConcentration: 0.5,
          totalRiskBudget: 60,
          maxLockingPeriod: 7,
          minApy: 1,
          excludedPools: [],
          maxGasPerRebalance: 50,
        },
        objectives: {
          maximize: 'RISK_ADJUSTED_RETURN' as const,
          riskAversion: 0.7, // Conservative
          timeHorizon: 7,
          rebalanceFrequency: RebalanceFrequency.DAILY,
        },
      };

      const result = await service.optimize(input);

      expect(result.allocations).toBeDefined();
      expect(result.allocations.length).toBeGreaterThan(0);
    });

    it('should return optimized allocations for Sortino ratio', async () => {
      const pools = [
        createMockPool({ id: 'pool-1', apy: 5.0, volatilityScore: 2.0, tvlUsd: 100000000 }),
        createMockPool({ id: 'pool-2', apy: 7.0, volatilityScore: 5.0, tvlUsd: 50000000 }),
        createMockPool({ id: 'pool-3', apy: 6.0, volatilityScore: 3.0, tvlUsd: 30000000 }),
      ];

      const input = {
        pools,
        availableCapital: 10000,
        constraints: {
          maxPools: 3,
          minPoolTvl: 1000000,
          maxConcentration: 0.5,
          totalRiskBudget: 70,
          maxLockingPeriod: 7,
          minApy: 1,
          excludedPools: [],
          maxGasPerRebalance: 50,
        },
        objectives: {
          maximize: 'SORTINO_RATIO' as const,
          riskAversion: 0.5,
          timeHorizon: 7,
          rebalanceFrequency: RebalanceFrequency.DAILY,
        },
      };

      const result = await service.optimize(input);

      expect(result.allocations).toBeDefined();
      expect(result.expectedSortinoRatio).toBeGreaterThan(0);
    });

    it('should respect concentration limits', async () => {
      const pools = [
        createMockPool({ id: 'pool-1', apy: 10.0, tvlUsd: 100000000 }),
        createMockPool({ id: 'pool-2', apy: 1.0, tvlUsd: 100000000 }),
      ];

      const input = {
        pools,
        availableCapital: 10000,
        constraints: {
          maxPools: 2,
          minPoolTvl: 1000000,
          maxConcentration: 0.3, // Max 30% in one pool
          totalRiskBudget: 70,
          maxLockingPeriod: 7,
          minApy: 1,
          excludedPools: [],
          maxGasPerRebalance: 50,
        },
        objectives: {
          maximize: 'APY' as const,
          riskAversion: 0.5,
          timeHorizon: 7,
          rebalanceFrequency: RebalanceFrequency.DAILY,
        },
      };

      const result = await service.optimize(input);

      // Check that no allocation exceeds 30%
      const maxAllocation = Math.max(...result.allocations.map(a => a.targetPercentage));
      expect(maxAllocation).toBeLessThanOrEqual(30);
    });

    it('should filter out pools below min TVL', async () => {
      const pools = [
        createMockPool({ id: 'pool-1', apy: 5.0, tvlUsd: 100000000 }),
        createMockPool({ id: 'pool-2', apy: 10.0, tvlUsd: 100000 }), // Too small
      ];

      const input = {
        pools,
        availableCapital: 10000,
        constraints: {
          maxPools: 2,
          minPoolTvl: 1000000, // Minimum $1M
          maxConcentration: 0.5,
          totalRiskBudget: 70,
          maxLockingPeriod: 7,
          minApy: 1,
          excludedPools: [],
          maxGasPerRebalance: 50,
        },
        objectives: {
          maximize: 'APY' as const,
          riskAversion: 0.5,
          timeHorizon: 7,
          rebalanceFrequency: RebalanceFrequency.DAILY,
        },
      };

      const result = await service.optimize(input);

      // Should only include pool-1
      expect(result.allocations.every(a => a.poolId !== 'pool-2')).toBe(true);
    });

    it('should exclude specified pools', async () => {
      const pools = [
        createMockPool({ id: 'pool-1', apy: 5.0, tvlUsd: 100000000 }),
        createMockPool({ id: 'pool-2', apy: 6.0, tvlUsd: 100000000 }),
      ];

      const input = {
        pools,
        availableCapital: 10000,
        constraints: {
          maxPools: 2,
          minPoolTvl: 1000000,
          maxConcentration: 0.5,
          totalRiskBudget: 70,
          maxLockingPeriod: 7,
          minApy: 1,
          excludedPools: ['pool-1'],
          maxGasPerRebalance: 50,
        },
        objectives: {
          maximize: 'APY' as const,
          riskAversion: 0.5,
          timeHorizon: 7,
          rebalanceFrequency: RebalanceFrequency.DAILY,
        },
      };

      const result = await service.optimize(input);

      expect(result.allocations.every(a => a.poolId !== 'pool-1')).toBe(true);
    });

    it('should run scenario analysis', async () => {
      const pools = [
        createMockPool({ id: 'pool-1', apy: 5.0, tvlUsd: 100000000 }),
        createMockPool({ id: 'pool-2', apy: 4.0, tvlUsd: 80000000 }),
      ];

      const input = {
        pools,
        availableCapital: 10000,
        constraints: {
          maxPools: 2,
          minPoolTvl: 1000000,
          maxConcentration: 0.5,
          totalRiskBudget: 70,
          maxLockingPeriod: 7,
          minApy: 1,
          excludedPools: [],
          maxGasPerRebalance: 50,
        },
        objectives: {
          maximize: 'RISK_ADJUSTED_RETURN' as const,
          riskAversion: 0.5,
          timeHorizon: 7,
          rebalanceFrequency: RebalanceFrequency.DAILY,
        },
      };

      const result = await service.optimize(input);

      expect(result.scenarioAnalysis).toBeDefined();
      expect(result.scenarioAnalysis.length).toBeGreaterThan(0);
      expect(result.scenarioAnalysis.some(s => s.name === 'Bull Market')).toBe(true);
      expect(result.scenarioAnalysis.some(s => s.name === 'Bear Market')).toBe(true);
    });

    it('should throw error when no eligible pools', async () => {
      const pools = [
        createMockPool({ id: 'pool-1', apy: 0.5, tvlUsd: 1000 }), // Below min TVL
      ];

      const input = {
        pools,
        availableCapital: 10000,
        constraints: {
          maxPools: 3,
          minPoolTvl: 1000000, // Too high for our test pool
          maxConcentration: 0.5,
          totalRiskBudget: 70,
          maxLockingPeriod: 7,
          minApy: 1,
          excludedPools: [],
          maxGasPerRebalance: 50,
        },
        objectives: {
          maximize: 'APY' as const,
          riskAversion: 0.5,
          timeHorizon: 7,
          rebalanceFrequency: RebalanceFrequency.DAILY,
        },
      };

      await expect(service.optimize(input)).rejects.toThrow('No eligible pools');
    });
  });

  describe('calculateRebalanceCost', () => {
    it('should calculate cost for full reallocation', () => {
      const currentAllocations = [
        { poolId: 'pool-1', targetPercentage: 0, actualPercentage: 50, currentValue: 5000, deviation: 50 },
        { poolId: 'pool-2', targetPercentage: 0, actualPercentage: 50, currentValue: 5000, deviation: 50 },
      ];

      const targetAllocations = [
        { poolId: 'pool-3', targetPercentage: 100, actualPercentage: 0, currentValue: 0, deviation: -100 },
      ];

      const constraints = {
        maxPools: 3,
        minPoolTvl: 1000000,
        maxConcentration: 0.5,
        totalRiskBudget: 70,
        maxLockingPeriod: 7,
        minApy: 1,
        excludedPools: [],
        maxGasPerRebalance: 50,
      };

      const cost = service.calculateRebalanceCost(currentAllocations, targetAllocations, constraints);

      expect(cost.totalCost).toBeGreaterThan(0);
      expect(cost.gasCost).toBeGreaterThan(0);
      expect(cost.slippageCost).toBeGreaterThan(0);
      expect(cost.trades).toBeGreaterThan(0);
    });

    it('should calculate cost for partial reallocation', () => {
      const currentAllocations = [
        { poolId: 'pool-1', targetPercentage: 30, actualPercentage: 50, currentValue: 5000, deviation: 20 },
        { poolId: 'pool-2', targetPercentage: 70, actualPercentage: 50, currentValue: 5000, deviation: -20 },
      ];

      const targetAllocations = [
        { poolId: 'pool-1', targetPercentage: 30, actualPercentage: 50, currentValue: 5000, deviation: 20 },
        { poolId: 'pool-2', targetPercentage: 70, actualPercentage: 50, currentValue: 5000, deviation: -20 },
      ];

      const constraints = {
        maxPools: 3,
        minPoolTvl: 1000000,
        maxConcentration: 0.5,
        totalRiskBudget: 70,
        maxLockingPeriod: 7,
        minApy: 1,
        excludedPools: [],
        maxGasPerRebalance: 50,
      };

      const cost = service.calculateRebalanceCost(currentAllocations, targetAllocations, constraints);

      expect(cost.totalCost).toBeGreaterThanOrEqual(0);
      expect(cost.trades).toBeGreaterThanOrEqual(0);
    });
  });
});
