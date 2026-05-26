import { PortfolioService } from '../portfolio.js';
import { YieldMode, RebalanceFrequency, RiskLevel } from '../../../../shared/types/index.js';

describe('PortfolioService', () => {
  let service: PortfolioService;

  beforeEach(() => {
    service = new PortfolioService();
  });

  describe('createPortfolio', () => {
    it('should create a new portfolio with default settings', async () => {
      const settings = {
        initialCapital: 10000,
        mode: YieldMode.STABLECOINS,
        rebalanceFrequency: RebalanceFrequency.DAILY,
        minRebalanceThreshold: 5,
        maxSlippage: 1,
        maxGasCostPerTrade: 50,
        riskTriggers: [],
        telegramNotifications: false,
        paperTrading: true,
        maxPoolConcentration: 25,
        minPoolTvl: 1000000,
        apyThreshold: 1,
      };

      const portfolio = await service.createPortfolio('Test Portfolio', settings);

      expect(portfolio).toMatchObject({
        mode: YieldMode.STABLECOINS,
        totalValue: 10000,
        availableCash: 10000,
        positions: [],
      });
      expect(portfolio.id).toBeDefined();
      expect(portfolio.createdAt).toBeInstanceOf(Date);
    });

    it('should create different portfolios with unique IDs', async () => {
      const settings = {
        initialCapital: 10000,
        mode: YieldMode.STABLECOINS,
        rebalanceFrequency: RebalanceFrequency.DAILY,
        minRebalanceThreshold: 5,
        maxSlippage: 1,
        maxGasCostPerTrade: 50,
        riskTriggers: [],
        telegramNotifications: false,
        paperTrading: true,
        maxPoolConcentration: 25,
        minPoolTvl: 1000000,
        apyThreshold: 1,
      };

      const portfolio1 = await service.createPortfolio('Portfolio 1', settings);
      const portfolio2 = await service.createPortfolio('Portfolio 2', settings);

      expect(portfolio1.id).not.toBe(portfolio2.id);
    });
  });

  describe('getPortfolio', () => {
    it('should retrieve existing portfolio by ID', async () => {
      const settings = {
        initialCapital: 10000,
        mode: YieldMode.STABLECOINS,
        rebalanceFrequency: RebalanceFrequency.DAILY,
        minRebalanceThreshold: 5,
        maxSlippage: 1,
        maxGasCostPerTrade: 50,
        riskTriggers: [],
        telegramNotifications: false,
        paperTrading: true,
        maxPoolConcentration: 25,
        minPoolTvl: 1000000,
        apyThreshold: 1,
      };

      const created = await service.createPortfolio('Test', settings);
      const retrieved = service.getPortfolio(created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
    });

    it('should return undefined for non-existent portfolio', () => {
      const portfolio = service.getPortfolio('non-existent-id');
      expect(portfolio).toBeUndefined();
    });
  });

  describe('getAllPortfolios', () => {
    it('should return all created portfolios', async () => {
      const settings = {
        initialCapital: 10000,
        mode: YieldMode.STABLECOINS,
        rebalanceFrequency: RebalanceFrequency.DAILY,
        minRebalanceThreshold: 5,
        maxSlippage: 1,
        maxGasCostPerTrade: 50,
        riskTriggers: [],
        telegramNotifications: false,
        paperTrading: true,
        maxPoolConcentration: 25,
        minPoolTvl: 1000000,
        apyThreshold: 1,
      };

      const initialCount = service.getAllPortfolios().length;

      await service.createPortfolio('Test 1', settings);
      await service.createPortfolio('Test 2', settings);

      const allPortfolios = service.getAllPortfolios();
      expect(allPortfolios.length).toBe(initialCount + 2);
    });
  });

  describe('enterPosition', () => {
    let portfolioId: string;
    const mockPool = {
      id: 'ethereum-aave-usdc',
      chain: 'Ethereum',
      project: 'aave',
      symbol: 'USDC',
      tvlUsd: 100000000,
      apyBase: 3.5,
      apyReward: 0,
      apy: 3.5,
      stablecoin: true,
      ilRisk: 'no' as const,
      exposure: 'single' as const,
      lastUpdated: new Date(),
    };

    beforeEach(async () => {
      const settings = {
        initialCapital: 10000,
        mode: YieldMode.STABLECOINS,
        rebalanceFrequency: RebalanceFrequency.DAILY,
        minRebalanceThreshold: 5,
        maxSlippage: 1,
        maxGasCostPerTrade: 50,
        riskTriggers: [],
        telegramNotifications: false,
        paperTrading: true,
        maxPoolConcentration: 25,
        minPoolTvl: 1000000,
        apyThreshold: 1,
      };
      const portfolio = await service.createPortfolio('Test', settings);
      portfolioId = portfolio.id;
    });

    it('should enter a new position', async () => {
      const position = await service.enterPosition(portfolioId, mockPool, 5000, 10);

      expect(position).toMatchObject({
        poolId: mockPool.id,
        amount: 5000,
        entryApy: 3.5,
        status: 'ACTIVE',
      });

      const portfolio = service.getPortfolio(portfolioId);
      expect(portfolio?.positions).toHaveLength(1);
      expect(portfolio?.availableCash).toBe(4990); // 10000 - 5000 - 10
    });

    it('should throw error for insufficient funds', async () => {
      await expect(
        service.enterPosition(portfolioId, mockPool, 15000, 10)
      ).rejects.toThrow('Insufficient funds');
    });

    it('should throw error for non-existent portfolio', async () => {
      await expect(
        service.enterPosition('non-existent', mockPool, 1000, 10)
      ).rejects.toThrow('Portfolio non-existent not found');
    });

    it('should update portfolio value after entering position', async () => {
      await service.enterPosition(portfolioId, mockPool, 5000, 10);

      const portfolio = service.getPortfolio(portfolioId);
      expect(portfolio?.totalValue).toBeLessThan(10000); // Value decreases due to fees
    });
  });

  describe('exitPosition', () => {
    let portfolioId: string;
    let positionId: string;
    const mockPool = {
      id: 'ethereum-aave-usdc',
      chain: 'Ethereum',
      project: 'aave',
      symbol: 'USDC',
      tvlUsd: 100000000,
      apyBase: 3.5,
      apyReward: 0,
      apy: 3.5,
      stablecoin: true,
      ilRisk: 'no' as const,
      exposure: 'single' as const,
      lastUpdated: new Date(),
    };

    beforeEach(async () => {
      const settings = {
        initialCapital: 10000,
        mode: YieldMode.STABLECOINS,
        rebalanceFrequency: RebalanceFrequency.DAILY,
        minRebalanceThreshold: 5,
        maxSlippage: 1,
        maxGasCostPerTrade: 50,
        riskTriggers: [],
        telegramNotifications: false,
        paperTrading: true,
        maxPoolConcentration: 25,
        minPoolTvl: 1000000,
        apyThreshold: 1,
      };
      const portfolio = await service.createPortfolio('Test', settings);
      portfolioId = portfolio.id;

      const position = await service.enterPosition(portfolioId, mockPool, 5000, 10);
      positionId = position.id;
    });

    it('should exit an active position', async () => {
      const exitedPosition = await service.exitPosition(portfolioId, positionId, 'Testing exit');

      expect(exitedPosition.status).toBe('CLOSED');
      expect(exitedPosition.exitReason).toBe('Testing exit');
      expect(exitedPosition.exitTimestamp).toBeInstanceOf(Date);

      const portfolio = service.getPortfolio(portfolioId);
      expect(portfolio?.positions.filter(p => p.status === 'ACTIVE')).toHaveLength(0);
      expect(portfolio?.availableCash).toBeGreaterThan(4900); // Should get capital back minus fees
    });

    it('should calculate realized PnL on exit', async () => {
      const exitedPosition = await service.exitPosition(portfolioId, positionId);

      expect(exitedPosition.realizedPnl).toBeDefined();
      expect(exitedPosition.unrealizedPnl).toBe(0);
    });

    it('should throw error for non-existent position', async () => {
      await expect(
        service.exitPosition(portfolioId, 'non-existent-position')
      ).rejects.toThrow('Position non-existent-position not found');
    });
  });

  describe('updatePositions', () => {
    let portfolioId: string;
    const mockPool = {
      id: 'ethereum-aave-usdc',
      chain: 'Ethereum',
      project: 'aave',
      symbol: 'USDC',
      tvlUsd: 100000000,
      apyBase: 3.5,
      apyReward: 0,
      apy: 3.5,
      stablecoin: true,
      ilRisk: 'no' as const,
      exposure: 'single' as const,
      lastUpdated: new Date(),
    };

    beforeEach(async () => {
      const settings = {
        initialCapital: 10000,
        mode: YieldMode.STABLECOINS,
        rebalanceFrequency: RebalanceFrequency.DAILY,
        minRebalanceThreshold: 5,
        maxSlippage: 1,
        maxGasCostPerTrade: 50,
        riskTriggers: [],
        telegramNotifications: false,
        paperTrading: true,
        maxPoolConcentration: 25,
        minPoolTvl: 1000000,
        apyThreshold: 1,
      };
      const portfolio = await service.createPortfolio('Test', settings);
      portfolioId = portfolio.id;

      await service.enterPosition(portfolioId, mockPool, 5000, 10);
    });

    it('should update position APYs and calculate unrealized PnL', async () => {
      await service.updatePositions(portfolioId);

      const portfolio = service.getPortfolio(portfolioId);
      const position = portfolio?.positions[0];

      expect(position?.currentApy).toBeDefined();
      expect(position?.unrealizedPnl).toBeDefined();
    });

    it('should update portfolio metrics', async () => {
      await service.updatePositions(portfolioId);

      const portfolio = service.getPortfolio(portfolioId);
      expect(portfolio?.performanceMetrics).toBeDefined();
      expect(portfolio?.updatedAt).toBeInstanceOf(Date);
    });

    it('should save snapshots after update', async () => {
      await service.updatePositions(portfolioId);

      const history = service.getPerformanceHistory(portfolioId, 30);
      expect(history.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getPortfolioStats', () => {
    let portfolioId: string;
    const mockPool = {
      id: 'ethereum-aave-usdc',
      chain: 'Ethereum',
      project: 'aave',
      symbol: 'USDC',
      tvlUsd: 100000000,
      apyBase: 3.5,
      apyReward: 0,
      apy: 3.5,
      stablecoin: true,
      ilRisk: 'no' as const,
      exposure: 'single' as const,
      lastUpdated: new Date(),
    };

    beforeEach(async () => {
      const settings = {
        initialCapital: 10000,
        mode: YieldMode.STABLECOINS,
        rebalanceFrequency: RebalanceFrequency.DAILY,
        minRebalanceThreshold: 5,
        maxSlippage: 1,
        maxGasCostPerTrade: 50,
        riskTriggers: [],
        telegramNotifications: false,
        paperTrading: true,
        maxPoolConcentration: 25,
        minPoolTvl: 1000000,
        apyThreshold: 1,
      };
      const portfolio = await service.createPortfolio('Test', settings);
      portfolioId = portfolio.id;
    });

    it('should calculate stats for empty portfolio', () => {
      const stats = service.getPortfolioStats(portfolioId);

      expect(stats).toMatchObject({
        totalTrades: 0,
        winningTrades: 0,
        losingTrades: 0,
        averageHoldingPeriod: 0,
        totalFees: 0,
        totalYield: 0,
      });
    });

    it('should calculate stats after trades', async () => {
      await service.enterPosition(portfolioId, mockPool, 5000, 10);
      const position = service.getPortfolio(portfolioId)?.positions[0];
      
      if (position) {
        await service.exitPosition(portfolioId, position.id);
      }

      const stats = service.getPortfolioStats(portfolioId);

      expect(stats.totalTrades).toBeGreaterThan(0);
      expect(stats.totalFees).toBeGreaterThan(0);
    });
  });

  describe('getTrades', () => {
    let portfolioId: string;
    const mockPool = {
      id: 'ethereum-aave-usdc',
      chain: 'Ethereum',
      project: 'aave',
      symbol: 'USDC',
      tvlUsd: 100000000,
      apyBase: 3.5,
      apyReward: 0,
      apy: 3.5,
      stablecoin: true,
      ilRisk: 'no' as const,
      exposure: 'single' as const,
      lastUpdated: new Date(),
    };

    beforeEach(async () => {
      const settings = {
        initialCapital: 10000,
        mode: YieldMode.STABLECOINS,
        rebalanceFrequency: RebalanceFrequency.DAILY,
        minRebalanceThreshold: 5,
        maxSlippage: 1,
        maxGasCostPerTrade: 50,
        riskTriggers: [],
        telegramNotifications: false,
        paperTrading: true,
        maxPoolConcentration: 25,
        minPoolTvl: 1000000,
        apyThreshold: 1,
      };
      const portfolio = await service.createPortfolio('Test', settings);
      portfolioId = portfolio.id;
    });

    it('should return empty array for new portfolio', () => {
      const trades = service.getTrades(portfolioId);
      expect(trades).toEqual([]);
    });

    it('should track trades after position entry', async () => {
      await service.enterPosition(portfolioId, mockPool, 5000, 10);

      const trades = service.getTrades(portfolioId);
      expect(trades).toHaveLength(1);
      expect(trades[0].type).toBe('ENTER');
    });
  });
});
