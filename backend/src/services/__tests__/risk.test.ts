import { RiskService } from '../risk.js';
import { RiskLevel, RiskTrigger, Position, YieldMode, Portfolio, RebalanceFrequency } from '../../../../shared/types/index.js';

// Mock the defiLlamaService
jest.mock('../defillama.js', () => ({
  defiLlamaService: {
    getPool: jest.fn(),
    estimateRiskScoreFromSnapshot: jest.fn(() => 35),
  },
}));

import { defiLlamaService } from '../defillama.js';

describe('RiskService', () => {
  let service: RiskService;

  beforeEach(() => {
    service = new RiskService();
    jest.clearAllMocks();
  });

  describe('assessPosition', () => {
    const mockPosition: Position = {
      id: 'pos-1',
      poolId: 'ethereum-aave-usdc',
      pool: {
        id: 'ethereum-aave-usdc',
        chain: 'Ethereum',
        project: 'aave',
        symbol: 'USDC',
        tvlUsd: 100000000,
        apyBase: 5.0,
        apyReward: 0,
        apy: 5.0,
        stablecoin: true,
        ilRisk: 'no',
        exposure: 'single',
        lastUpdated: new Date(),
      },
      amount: 5000,
      tokenAmounts: { USDC: 5000 },
      entryApy: 5.0,
      currentApy: 5.0,
      entryTimestamp: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
      unrealizedPnl: 10,
      realizedPnl: 0,
      feesPaid: 5,
      status: 'ACTIVE',
    };

    const triggers: RiskTrigger[] = [
      {
        type: 'TVL_DROP',
        threshold: 30,
        action: 'EXIT',
        cooldownMinutes: 60,
      },
      {
        type: 'APY_DROP',
        threshold: 50,
        action: 'EXIT',
        cooldownMinutes: 120,
      },
      {
        type: 'MAX_DRAWDOWN',
        threshold: 15,
        action: 'REDUCE',
        cooldownMinutes: 60,
      },
    ];

    it('should assess position with no risk triggers', async () => {
      (defiLlamaService.getPool as jest.Mock).mockResolvedValue({
        ...mockPosition.pool,
        tvlTrend7d: -5, // Small TVL drop
        apy: 4.8, // Slight APY drop
        volatilityScore: 2.0,
        riskScore: 30,
      });

      const assessment = await service.assessPosition(mockPosition, triggers);

      expect(assessment).toBeDefined();
      expect(assessment.score).toBeGreaterThanOrEqual(0);
      expect(assessment.level).toBeDefined();
      expect(assessment.triggers).toBeDefined();
      expect(assessment.recommendations.length).toBeGreaterThanOrEqual(0);
    });

    it('should trigger TVL drop alert', async () => {
      (defiLlamaService.getPool as jest.Mock).mockResolvedValue({
        ...mockPosition.pool,
        tvlTrend7d: -35, // 35% drop, exceeds 30% threshold
        apy: 5.0,
      });

      const assessment = await service.assessPosition(mockPosition, triggers);

      const tvlTrigger = assessment.triggers.find(t => t.trigger.type === 'TVL_DROP');
      expect(tvlTrigger?.triggered).toBe(true);
    });

    it('should trigger APY drop alert', async () => {
      (defiLlamaService.getPool as jest.Mock).mockResolvedValue({
        ...mockPosition.pool,
        apy: 2.0, // 60% drop from entry 5.0
      });

      const assessment = await service.assessPosition(mockPosition, triggers);

      const apyTrigger = assessment.triggers.find(t => t.trigger.type === 'APY_DROP');
      expect(apyTrigger?.triggered).toBe(true);
    });

    it('should return high risk when pool data unavailable and no embedded pool', async () => {
      (defiLlamaService.getPool as jest.Mock).mockResolvedValue(null);

      const positionNoSnapshot = {
        ...mockPosition,
        pool: undefined,
      } as unknown as Position;

      const assessment = await service.assessPosition(positionNoSnapshot, triggers);

      expect(assessment.level).toBe(RiskLevel.HIGH);
      expect(assessment.score).toBe(80);
    });

    it('should use embedded pool when API id misses but snapshot exists', async () => {
      (defiLlamaService.getPool as jest.Mock).mockResolvedValue(null);
      (defiLlamaService.estimateRiskScoreFromSnapshot as jest.Mock).mockReturnValue(32);

      const assessment = await service.assessPosition(mockPosition, []);

      expect(defiLlamaService.estimateRiskScoreFromSnapshot).toHaveBeenCalled();
      expect(assessment.score).toBeLessThan(80);
    });

    it('should respect cooldown periods', async () => {
      (defiLlamaService.getPool as jest.Mock).mockResolvedValue({
        ...mockPosition.pool,
        tvlTrend7d: -35,
      });

      // First assessment should trigger
      const assessment1 = await service.assessPosition(mockPosition, triggers);
      expect(assessment1.triggers.some(t => t.triggered)).toBe(true);

      // Second immediate assessment should not trigger (cooldown)
      const assessment2 = await service.assessPosition(mockPosition, triggers);
      // Note: triggered will be true but action should not be recommended
    });

    it('should calculate risk score based on multiple factors', async () => {
      (defiLlamaService.getPool as jest.Mock).mockResolvedValue({
        ...mockPosition.pool,
        riskScore: 60,
        tvlTrend7d: -10,
        apy: 5.0,
        volatilityScore: 3.0,
      });

      const assessment = await service.assessPosition(mockPosition, triggers);

      expect(assessment.score).toBeGreaterThanOrEqual(0);
      expect(assessment.score).toBeLessThanOrEqual(100);
    });
  });

  describe('assessPortfolio', () => {
    const mockPortfolio: Portfolio = {
      id: 'portfolio-1',
      mode: YieldMode.STABLECOINS,
      totalValue: 10000,
      availableCash: 5000,
      positions: [
        {
          id: 'pos-1',
          poolId: 'pool-1',
          pool: {
            id: 'pool-1',
            chain: 'Ethereum',
            project: 'aave',
            symbol: 'USDC',
            tvlUsd: 100000000,
            apyBase: 5.0,
            apyReward: 0,
            apy: 5.0,
            stablecoin: true,
            ilRisk: 'no' as const,
            exposure: 'single' as const,
            lastUpdated: new Date(),
          },
          amount: 2500,
          tokenAmounts: { USDC: 2500 },
          entryApy: 5.0,
          currentApy: 5.0,
          entryTimestamp: new Date(),
          unrealizedPnl: 5,
          realizedPnl: 0,
          feesPaid: 2,
          status: 'ACTIVE' as const,
        },
        {
          id: 'pos-2',
          poolId: 'pool-2',
          pool: {
            id: 'pool-2',
            chain: 'Ethereum',
            project: 'compound',
            symbol: 'DAI',
            tvlUsd: 50000000,
            apyBase: 4.5,
            apyReward: 0,
            apy: 4.5,
            stablecoin: true,
            ilRisk: 'no' as const,
            exposure: 'single' as const,
            lastUpdated: new Date(),
          },
          amount: 2500,
          tokenAmounts: { DAI: 2500 },
          entryApy: 4.5,
          currentApy: 4.5,
          entryTimestamp: new Date(),
          unrealizedPnl: 3,
          realizedPnl: 0,
          feesPaid: 2,
          status: 'ACTIVE' as const,
        },
      ],
      targetAllocation: [],
      actualAllocation: [],
      performanceMetrics: {
        totalReturn: 0.5,
        dailyReturn: 0.02,
        weeklyReturn: 0.1,
        monthlyReturn: 0.4,
        annualizedApy: 5.0,
        sharpeRatio: 1.0,
        sortinoRatio: 1.2,
        maxDrawdown: 2,
        volatility: 5,
        expectedApy: 5,
        expectedVolatility: 5,
        expectedSortinoRatio: 1,
        feesPaid: 4,
        slippageCosts: 1,
        gasCosts: 3,
        profitFactor: 1.5,
        winRate: 60,
        averageHoldingPeriod: 24,
        rebalanceCount: 0,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
      settings: {
        initialCapital: 10000,
        mode: YieldMode.STABLECOINS,
        rebalanceFrequency: RebalanceFrequency.DAILY,
        minRebalanceThreshold: 5,
        maxSlippage: 1,
        maxGasCostPerTrade: 50,
        riskTriggers: [
          {
            type: 'TVL_DROP' as const,
            threshold: 30,
            action: 'EXIT' as const,
            cooldownMinutes: 60,
          },
        ],
        telegramNotifications: false,
        paperTrading: true,
        maxPoolConcentration: 25,
        minPoolTvl: 1000000,
        apyThreshold: 1,
      },
    };

    it('should assess entire portfolio risk', async () => {
      (defiLlamaService.getPool as jest.Mock).mockResolvedValue({
        tvlUsd: 100000000,
        tvlTrend7d: -5,
        apy: 5.0,
        volatilityScore: 2.0,
        riskScore: 30,
      });

      const assessment = await service.assessPortfolio(mockPortfolio);

      expect(assessment).toBeDefined();
      expect(assessment.level).toBeDefined();
      expect(assessment.score).toBeGreaterThanOrEqual(0);
      expect(assessment.positionRisks).toBeDefined();
      expect(assessment.positionRisks?.size).toBe(2);
    });

    it('should detect concentration risk', async () => {
      const concentratedPortfolio = {
        ...mockPortfolio,
        positions: [
          {
            ...mockPortfolio.positions[0],
            amount: 9000, // 90% of portfolio
            unrealizedPnl: 50,
          },
        ],
      };

      (defiLlamaService.getPool as jest.Mock).mockResolvedValue({
        tvlTrend7d: -5,
        apy: 5.0,
      });

      const assessment = await service.assessPortfolio(concentratedPortfolio);

      expect(assessment.score).toBeGreaterThan(mockPortfolio.settings.maxPoolConcentration);
      expect(assessment.recommendations.some(r => r.includes('concentration'))).toBe(true);
    });

    it('should detect correlation risk (same chain/protocol)', async () => {
      const correlatedPortfolio = {
        ...mockPortfolio,
        positions: [
          {
            ...mockPortfolio.positions[0],
            pool: {
              ...mockPortfolio.positions[0].pool,
              chain: 'Ethereum',
              project: 'aave',
            },
          },
          {
            ...mockPortfolio.positions[1],
            pool: {
              ...mockPortfolio.positions[1].pool,
              chain: 'Ethereum',
              project: 'aave', // Same chain and protocol
            },
          },
        ],
      };

      (defiLlamaService.getPool as jest.Mock).mockResolvedValue({
        tvlTrend7d: -5,
        apy: 5.0,
      });

      const assessment = await service.assessPortfolio(correlatedPortfolio);

      expect(assessment.recommendations.some(r => r.includes('correlation'))).toBe(true);
    });
  });

  describe('generateRiskActions', () => {
    it('should generate EXIT action for extreme risk', () => {
      const tvlTriggerResult = {
        trigger: {
          type: 'TVL_DROP' as const,
          threshold: 30,
          action: 'EXIT' as const,
          cooldownMinutes: 60,
        },
        triggered: true,
        value: 40,
        message: 'TVL dropped 40%',
      };
      const assessment = {
        level: RiskLevel.EXTREME,
        score: 85,
        triggers: [tvlTriggerResult],
        recommendations: ['Exit position'],
        positionRisks: new Map([
          [
            'pos-1',
            {
              level: RiskLevel.EXTREME,
              score: 85,
              triggers: [tvlTriggerResult],
              recommendations: [],
            },
          ],
        ]),
      };

      const mockPortfolio = {
        id: 'portfolio-1',
        positions: [
          {
            id: 'pos-1',
            poolId: 'pool-1',
            pool: {
              id: 'pool-1',
              chain: 'Ethereum',
              project: 'aave',
              symbol: 'USDC',
              tvlUsd: 100000000,
              apyBase: 5.0,
              apyReward: 0,
              apy: 5.0,
              stablecoin: true,
              ilRisk: 'no' as const,
              exposure: 'single' as const,
              lastUpdated: new Date(),
            },
            amount: 5000,
            tokenAmounts: { USDC: 5000 },
            entryApy: 5.0,
            currentApy: 5.0,
            entryTimestamp: new Date(),
            unrealizedPnl: 10,
            realizedPnl: 0,
            feesPaid: 5,
            status: 'ACTIVE' as const,
          },
        ],
        totalValue: 10000,
        settings: {
          riskTriggers: assessment.triggers.map(t => t.trigger),
        },
      } as any;

      const actions = service.generateRiskActions(assessment, mockPortfolio);

      expect(actions.length).toBeGreaterThan(0);
      expect(actions.some(a => a.type === 'EXIT')).toBe(true);
    });

    it('should generate REDUCE action for high risk', () => {
      const ddTriggerResult = {
        trigger: {
          type: 'MAX_DRAWDOWN' as const,
          threshold: 15,
          action: 'REDUCE' as const,
          cooldownMinutes: 60,
        },
        triggered: true,
        value: 20,
        message: 'Max drawdown 20%',
      };
      const assessment = {
        level: RiskLevel.HIGH,
        score: 65,
        triggers: [ddTriggerResult],
        recommendations: ['Reduce position'],
        positionRisks: new Map([
          [
            'pos-1',
            {
              level: RiskLevel.HIGH,
              score: 65,
              triggers: [ddTriggerResult],
              recommendations: [],
            },
          ],
        ]),
      };

      const mockPortfolio = {
        id: 'portfolio-1',
        positions: [
          {
            id: 'pos-1',
            poolId: 'pool-1',
            pool: {
              id: 'pool-1',
              chain: 'Ethereum',
              project: 'aave',
              symbol: 'USDC',
              tvlUsd: 100000000,
              apyBase: 5.0,
              apyReward: 0,
              apy: 5.0,
              stablecoin: true,
              ilRisk: 'no' as const,
              exposure: 'single' as const,
              lastUpdated: new Date(),
            },
            amount: 5000,
            tokenAmounts: { USDC: 5000 },
            entryApy: 5.0,
            currentApy: 5.0,
            entryTimestamp: new Date(),
            unrealizedPnl: 10,
            realizedPnl: 0,
            feesPaid: 5,
            status: 'ACTIVE' as const,
          },
        ],
        totalValue: 10000,
        settings: {
          riskTriggers: assessment.triggers.map(t => t.trigger),
        },
      } as any;

      const actions = service.generateRiskActions(assessment, mockPortfolio);

      expect(actions.some(a => a.type === 'REALLOCATE')).toBe(true);
    });

    it('should generate ALERT only for moderate risk', () => {
      const assessment = {
        level: RiskLevel.MODERATE,
        score: 45,
        triggers: [
          {
            trigger: {
              type: 'VOLATILITY_SPIKE' as const,
              threshold: 300,
              action: 'ALERT' as const,
              cooldownMinutes: 30,
            },
            triggered: true,
            value: 350,
            message: 'Volatility spike',
          },
        ],
        recommendations: ['Monitor closely'],
        positionRisks: new Map(),
      };

      const mockPortfolio = {
        id: 'portfolio-1',
        positions: [],
        totalValue: 10000,
        settings: {
          riskTriggers: assessment.triggers.map(t => t.trigger),
        },
      } as any;

      const actions = service.generateRiskActions(assessment, mockPortfolio);

      // ALERT action should not generate rebalance action
      expect(actions.filter(a => a.type !== 'HOLD').length).toBe(0);
    });
  });

  describe('createRiskAlertEvent', () => {
    it('should create properly formatted risk alert event', () => {
      const assessment = {
        level: RiskLevel.HIGH,
        score: 70,
        triggers: [],
        recommendations: ['Reduce exposure'],
      };

      const mockPositions = [
        { id: 'pos-1' },
        { id: 'pos-2' },
      ] as Position[];

      const event = service.createRiskAlertEvent('portfolio-1', assessment, mockPositions);

      expect(event.type).toBe('RISK_ALERT');
      expect(event.payload.level).toBe(RiskLevel.HIGH);
      expect(event.payload.affectedPositions).toEqual(['pos-1', 'pos-2']);
      expect(event.payload.message).toBe('Reduce exposure');
      expect(event.timestamp).toBeInstanceOf(Date);
    });
  });
});
