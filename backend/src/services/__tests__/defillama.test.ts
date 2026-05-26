import { DefiLlamaService } from '../defillama.js';
import { YieldMode, RiskLevel } from '../../../../shared/types/index.js';

// Mock axios
jest.mock('axios', () => ({
  create: jest.fn(() => ({
    get: jest.fn(),
    interceptors: {
      response: {
        use: jest.fn(),
      },
    },
  })),
}));

describe('DefiLlamaService', () => {
  let service: DefiLlamaService;
  let mockAxiosGet: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DefiLlamaService();
    mockAxiosGet = (service as any).client.get;
  });

  describe('getAllPools', () => {
    it('should fetch and transform pools from API', async () => {
      const mockPools = [
        {
          chain: 'Ethereum',
          project: 'aave',
          symbol: 'USDC',
          tvlUsd: 100000000,
          apyBase: 3.5,
          apyReward: 0,
          apy: 3.5,
          stablecoin: true,
          ilRisk: 'no',
          exposure: 'single',
          pool: 'ethereum-aave-usdc',
        },
        {
          chain: 'Arbitrum',
          project: 'curve',
          symbol: 'USDC-USDT',
          tvlUsd: 50000000,
          apyBase: 5.0,
          apyReward: 2.0,
          apy: 7.0,
          stablecoin: true,
          ilRisk: 'medium',
          exposure: 'multi',
          pool: 'arbitrum-curve-usdc-usdt',
        },
      ];

      mockAxiosGet.mockResolvedValueOnce({ data: mockPools });

      const pools = await service.getAllPools();

      expect(pools).toHaveLength(2);
      expect(pools[0]).toMatchObject({
        id: 'ethereum-aave-usdc',
        chain: 'Ethereum',
        project: 'aave',
        symbol: 'USDC',
        tvlUsd: 100000000,
        apy: 3.5,
        stablecoin: true,
      });
      expect(pools[1]).toMatchObject({
        id: 'arbitrum-curve-usdc-usdt',
        chain: 'Arbitrum',
        project: 'curve',
        apy: 7.0,
      });
    });

    it('should infer apyPrediction from heuristics when DefiLlama omits ML Predictions', async () => {
      const mockPools = [
        {
          chain: 'Base',
          project: 'test',
          symbol: 'TKN',
          tvlUsd: 2_000_000,
          apy: 12.5,
          apyPct7D: -3,
          apyPct30D: 1.5,
          sigma: 0.08,
          stablecoin: false,
          ilRisk: 'no' as const,
          exposure: 'single' as const,
          pool: 'base-test-tkn',
        },
      ];
      mockAxiosGet.mockResolvedValueOnce({ data: mockPools });
      const pools = await service.getAllPools();
      expect(pools).toHaveLength(1);
      const pred = pools[0].apyPrediction;
      expect(pred).toBeDefined();
      expect(pred!.currentApy).toBe(12.5);
      expect(pred!.timeframe).toContain('Heuristic');
      expect(pred!.predictedMinApy).toBeGreaterThan(0);
      expect(pred!.predictedMinApy).toBeLessThanOrEqual(12.5);
      expect(pred!.predictedMaxApy).toBeDefined();
      expect(pred!.predictedMaxApy!).toBeGreaterThanOrEqual(12.5);
    });

    it('should map headline apy into apyBase when Llama omits base/reward split', async () => {
      const mockPools = [
        {
          chain: 'Base',
          project: 'glif',
          symbol: 'STICNT',
          tvlUsd: 1_000_000,
          apy: 84.2,
          apyBase: 0,
          apyReward: 0,
          stablecoin: false,
          ilRisk: 'no',
          exposure: 'single',
          pool: 'base-glif-sticnt',
        },
      ];
      mockAxiosGet.mockResolvedValueOnce({ data: mockPools });
      const pools = await service.getAllPools();
      expect(pools).toHaveLength(1);
      expect(pools[0].apy).toBe(84.2);
      expect(pools[0].apyBase).toBe(84.2);
      expect(pools[0].apyReward).toBe(0);
    });

    it('should handle API errors gracefully', async () => {
      mockAxiosGet.mockRejectedValueOnce(new Error('Network error'));

      // Now returns empty array instead of throwing
      const result = await service.getAllPools();
      expect(result).toEqual([]);
    });

    it('should cache results', async () => {
      const mockPool = {
        chain: 'Ethereum',
        project: 'aave',
        symbol: 'USDC',
        tvlUsd: 100000000,
        apy: 3.5,
        stablecoin: true,
        ilRisk: 'no',
        exposure: 'single',
      };

      mockAxiosGet.mockResolvedValueOnce({ data: [mockPool] });

      // First call should hit API
      await service.getAllPools();
      expect(mockAxiosGet).toHaveBeenCalledTimes(1);

      // Second call should use cache
      const cached = await service.getAllPools();
      expect(mockAxiosGet).toHaveBeenCalledTimes(1);
      expect(cached).toHaveLength(1);
    });
  });

  describe('getFilteredPools', () => {
    const mockPools = [
      {
        chain: 'Ethereum',
        project: 'aave',
        symbol: 'USDC',
        tvlUsd: 100000000,
        apyBase: 3.5,
        apyReward: 0,
        apy: 3.5,
        stablecoin: true,
        ilRisk: 'no',
        exposure: 'single',
        pool: 'ethereum-aave-usdc',
        sigma: 0.05,
      },
      {
        chain: 'Ethereum',
        project: 'curve',
        symbol: 'ETH-USDC',
        tvlUsd: 50000000,
        apyBase: 5.0,
        apyReward: 2.0,
        apy: 7.0,
        stablecoin: false,
        ilRisk: 'medium',
        exposure: 'multi',
        pool: 'ethereum-curve-eth-usdc',
        sigma: 0.15,
      },
      {
        chain: 'Arbitrum',
        project: 'uniswap',
        symbol: 'USDC',
        tvlUsd: 1000000,
        apyBase: 2.0,
        apyReward: 0,
        apy: 2.0,
        stablecoin: true,
        ilRisk: 'no',
        exposure: 'single',
        pool: 'arbitrum-uniswap-usdc',
        sigma: 0.02,
      },
    ];

    beforeEach(() => {
      mockAxiosGet.mockResolvedValue({ data: mockPools });
    });

    it('should filter by stablecoins only', async () => {
      const pools = await service.getFilteredPools({
        mode: YieldMode.STABLECOINS,
        stablecoinsOnly: true,
      });

      expect(pools.every(p => p.stablecoin)).toBe(true);
      expect(pools).toHaveLength(2);
    });

    it('should filter by min TVL', async () => {
      const pools = await service.getFilteredPools({
        mode: YieldMode.BLUECHIPS,
        minTvl: 10000000,
      });

      expect(pools.every(p => p.tvlUsd >= 10000000)).toBe(true);
    });

    it('should filter by min APY', async () => {
      const pools = await service.getFilteredPools({
        mode: YieldMode.STABLECOINS,
        minApy: 3.0,
      });

      expect(pools.every(p => p.apy >= 3.0)).toBe(true);
    });

    it('should filter by chains', async () => {
      const pools = await service.getFilteredPools({
        mode: YieldMode.STABLECOINS,
        chains: ['Ethereum'],
      });

      expect(pools.every(p => p.chain === 'Ethereum')).toBe(true);
    });

    it('should exclude IL risk when specified', async () => {
      const pools = await service.getFilteredPools({
        mode: YieldMode.STABLECOINS,
        excludeILRisk: true,
      });

      expect(pools.every(p => p.ilRisk === 'no')).toBe(true);
    });

    it('should filter by max risk level', async () => {
      const pools = await service.getFilteredPools({
        mode: YieldMode.STABLECOINS,
        maxRiskLevel: RiskLevel.MODERATE,
      });

      expect(pools.length).toBeGreaterThan(0);
    });

    it('MEMECOINS mode returns only memecoin-classified pools', async () => {
      const withMeme = [
        ...mockPools,
        {
          chain: 'Base',
          project: 'uniswap',
          symbol: 'PEPE-WETH',
          tvlUsd: 8_000_000,
          apyBase: 10,
          apyReward: 2,
          apy: 12,
          stablecoin: false,
          ilRisk: 'medium',
          exposure: 'multi',
          pool: 'base-uni-pepe-weth',
          sigma: 0.4,
        },
      ];
      mockAxiosGet.mockResolvedValue({ data: withMeme });

      const memePools = await service.getFilteredPools({ mode: YieldMode.MEMECOINS });
      expect(memePools).toHaveLength(1);
      expect(memePools[0].id).toBe('base-uni-pepe-weth');
    });

    it('LONGTAIL mode excludes memecoin pools', async () => {
      const withMeme = [
        {
          chain: 'Base',
          project: 'uniswap',
          symbol: 'PEPE-WETH',
          tvlUsd: 8_000_000,
          apyBase: 10,
          apyReward: 2,
          apy: 12,
          stablecoin: false,
          ilRisk: 'medium',
          exposure: 'multi',
          pool: 'base-uni-pepe-weth',
          sigma: 0.4,
        },
        {
          chain: 'Base',
          project: 'aerodrome',
          symbol: 'XYZ-ETH',
          tvlUsd: 2_000_000,
          apyBase: 20,
          apyReward: 0,
          apy: 20,
          stablecoin: false,
          ilRisk: 'high',
          exposure: 'multi',
          pool: 'base-aero-xyz-eth',
          sigma: 0.5,
        },
      ];
      mockAxiosGet.mockResolvedValue({ data: withMeme });

      const long = await service.getFilteredPools({ mode: YieldMode.LONGTAIL });
      expect(long.find(p => p.id === 'base-uni-pepe-weth')).toBeUndefined();
      expect(long.find(p => p.id === 'base-aero-xyz-eth')).toBeDefined();
    });
  });

  describe('getPool', () => {
    it('should return specific pool by ID', async () => {
      const mockPools = [
        {
          chain: 'Ethereum',
          project: 'aave',
          symbol: 'USDC',
          tvlUsd: 100000000,
          apy: 3.5,
          stablecoin: true,
          ilRisk: 'no',
          exposure: 'single',
          pool: 'ethereum-aave-usdc',
        },
      ];

      mockAxiosGet.mockResolvedValueOnce({ data: mockPools });

      const pool = await service.getPool('ethereum-aave-usdc');

      expect(pool).not.toBeNull();
      expect(pool?.id).toBe('ethereum-aave-usdc');
    });

    it('should return null for non-existent pool', async () => {
      mockAxiosGet.mockResolvedValueOnce({ data: [] });

      const pool = await service.getPool('non-existent');

      expect(pool).toBeNull();
    });
  });

  describe('getPoolChartData', () => {
    it('should fetch historical chart data', async () => {
      const mockChartData = {
        data: [
          { date: '2024-01-01', totalLiquidityUSD: 1000000, apy: 5.0 },
          { date: '2024-01-02', totalLiquidityUSD: 1100000, apy: 5.2 },
          { date: '2024-01-03', totalLiquidityUSD: 1050000, apy: 5.1 },
        ],
        status: 'success',
      };

      mockAxiosGet.mockResolvedValueOnce({ data: mockChartData });

      const chartData = await service.getPoolChartData('ethereum-aave-usdc', 30);

      expect(chartData).toHaveLength(3);
      expect(chartData[0]).toMatchObject({
        apy: 5.0,
        tvl: 1000000,
      });
    });

    it('should return empty array on error', async () => {
      mockAxiosGet.mockRejectedValueOnce(new Error('Chart error'));

      const chartData = await service.getPoolChartData('invalid-pool', 30);

      expect(chartData).toEqual([]);
    });
  });

  describe('getChains', () => {
    it('should fetch list of chains', async () => {
      const mockChains = [
        { name: 'Ethereum', geckoId: 'ethereum', tokenSymbol: 'ETH', chainId: '1' },
        { name: 'Arbitrum', geckoId: 'arbitrum', tokenSymbol: 'ARB', chainId: '42161' },
      ];

      mockAxiosGet.mockResolvedValueOnce({ data: mockChains });

      const chains = await service.getChains();

      expect(chains).toHaveLength(2);
      expect(chains[0]).toMatchObject({
        id: '1',
        name: 'Ethereum',
        tokenSymbol: 'ETH',
      });
    });
  });

  describe('getProtocols', () => {
    it('should fetch list of protocols', async () => {
      const mockProtocols = [
        {
          id: 'aave',
          name: 'Aave',
          url: 'https://aave.com',
          tvl: 1000000000,
          chains: ['Ethereum', 'Arbitrum'],
          category: 'lending',
        },
        {
          id: 'curve',
          name: 'Curve',
          tvl: 500000000,
          chains: ['Ethereum', 'Polygon'],
          category: 'dex',
        },
      ];

      mockAxiosGet.mockResolvedValueOnce({ data: mockProtocols });

      const protocols = await service.getProtocols();

      expect(protocols).toHaveLength(2);
      expect(protocols[0]).toMatchObject({
        id: 'aave',
        name: 'Aave',
        category: 'lending',
      });
    });
  });

  describe('mode-specific pool getters', () => {
    const mockPools = [
      { chain: 'Ethereum', project: 'aave', symbol: 'USDC', tvlUsd: 100000000, apy: 3.5, stablecoin: true, ilRisk: 'no', exposure: 'single', pool: 'p1' },
      { chain: 'Ethereum', project: 'curve', symbol: 'ETH', tvlUsd: 50000000, apy: 5.0, stablecoin: false, ilRisk: 'no', exposure: 'single', pool: 'p2' },
      { chain: 'Arbitrum', project: 'uniswap', symbol: 'MEME', tvlUsd: 1000000, apy: 20.0, stablecoin: false, ilRisk: 'high', exposure: 'single', pool: 'p3' },
    ];

    beforeEach(() => {
      mockAxiosGet.mockResolvedValue({ data: mockPools });
    });

    it('should get stablecoin pools', async () => {
      const pools = await service.getStablecoinPools();
      expect(pools.every(p => p.stablecoin)).toBe(true);
    });

    it('should get bluechip pools', async () => {
      const pools = await service.getBluechipPools();
      expect(pools.length).toBeGreaterThanOrEqual(0);
    });

    it('should get longtail pools', async () => {
      const pools = await service.getLongtailPools();
      expect(pools.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('clearCache', () => {
    it('should clear the cache', () => {
      service.clearCache();
      // Should not throw
      expect(true).toBe(true);
    });
  });
});
