import { DefiLlamaScraper } from '../scraper.js';
import { YieldMode } from '../../../../shared/types/index.js';

// Mock puppeteer
jest.mock('puppeteer', () => ({
  launch: jest.fn().mockResolvedValue({
    newPage: jest.fn().mockResolvedValue({
      setUserAgent: jest.fn(),
      setViewport: jest.fn(),
      setRequestInterception: jest.fn(),
      on: jest.fn(),
      goto: jest.fn(),
      waitForSelector: jest.fn(),
      evaluate: jest.fn().mockResolvedValue([]),
      close: jest.fn(),
    }),
    close: jest.fn(),
  }),
}));

jest.useFakeTimers();

describe('DefiLlamaScraper', () => {
  let scraper: DefiLlamaScraper;

  beforeEach(() => {
    jest.clearAllMocks();
    scraper = new DefiLlamaScraper({
      headless: true,
      requestDelay: 100,
      maxRequestsPerMinute: 60,
    });
  });

  afterEach(async () => {
    await scraper.close();
  });

  describe('constructor', () => {
    it('should create scraper with default config', () => {
      const defaultScraper = new DefiLlamaScraper();
      expect(defaultScraper).toBeDefined();
    });

    it('should create scraper with custom config', () => {
      const customScraper = new DefiLlamaScraper({
        headless: false,
        slowMo: 500,
        requestDelay: 5000,
        maxRequestsPerMinute: 5,
      });
      expect(customScraper).toBeDefined();
    });
  });

  describe('init', () => {
    it('should initialize browser', async () => {
      await scraper.init();
      // Should not throw
      expect(true).toBe(true);
    });

    it('should not reinitialize if already initialized', async () => {
      await scraper.init();
      await scraper.init(); // Second call
      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('close', () => {
    it('should close browser gracefully', async () => {
      await scraper.init();
      await scraper.close();
      // Should not throw
      expect(true).toBe(true);
    });

    it('should handle close when not initialized', async () => {
      await scraper.close();
      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('scrapeYieldsPage', () => {
    it('should scrape yields page for stablecoins', async () => {
      const mockEvaluateResult = [
        {
          id: 'ethereum-aave-usdc',
          chain: 'Ethereum',
          project: 'aave',
          symbol: 'USDC',
          apy: 3.5,
          tvlUsd: 1000000,
        },
      ];

      // Setup mock to return data
      const mockPage = {
        setUserAgent: jest.fn(),
        setViewport: jest.fn(),
        setRequestInterception: jest.fn(),
        on: jest.fn(),
        goto: jest.fn(),
        waitForSelector: jest.fn(),
        evaluate: jest.fn().mockResolvedValue(mockEvaluateResult),
        close: jest.fn(),
      };

      const { launch } = require('puppeteer');
      launch.mockResolvedValueOnce({
        newPage: jest.fn().mockResolvedValue(mockPage),
        close: jest.fn(),
      });

      const result = await scraper.scrapeYieldsPage(YieldMode.STABLECOINS);

      expect(result).toBeDefined();
      expect(result.timestamp).toBeInstanceOf(Date);
      expect(result.pools).toBeDefined();
      expect(result.apiResponses).toBeDefined();
    });

    it('should scrape yields page for bluechips', async () => {
      const mockEvaluateResult: any[] = [];

      const mockPage = {
        setUserAgent: jest.fn(),
        setViewport: jest.fn(),
        setRequestInterception: jest.fn(),
        on: jest.fn(),
        goto: jest.fn(),
        waitForSelector: jest.fn(),
        evaluate: jest.fn().mockResolvedValue(mockEvaluateResult),
        close: jest.fn(),
      };

      const { launch } = require('puppeteer');
      launch.mockResolvedValueOnce({
        newPage: jest.fn().mockResolvedValue(mockPage),
        close: jest.fn(),
      });

      const result = await scraper.scrapeYieldsPage(YieldMode.BLUECHIPS);

      expect(result).toBeDefined();
    });

    it('should handle errors gracefully', async () => {
      const { launch } = require('puppeteer');
      launch.mockRejectedValueOnce(new Error('Browser launch failed'));

      const newScraper = new DefiLlamaScraper();
      await expect(
        newScraper.scrapeYieldsPage(YieldMode.STABLECOINS)
      ).rejects.toThrow('Browser launch failed');
    });
  });

  describe('scrapePoolDetail', () => {
    it('should scrape pool detail page', async () => {
      const mockEvaluateResult = {
        name: 'USDC Pool',
        chain: 'Ethereum',
        project: 'aave',
        apy: 3.5,
        tvl: 1000000,
        outlook: {
          currentApy: 3.5,
          predictedMinApy: 3.0,
          confidence: 'HIGH',
          timeframe: '4 weeks',
        },
        chartData: [],
      };

      const mockPage = {
        setUserAgent: jest.fn(),
        setViewport: jest.fn(),
        setRequestInterception: jest.fn(),
        on: jest.fn(),
        goto: jest.fn(),
        waitForSelector: jest.fn(),
        evaluate: jest.fn().mockResolvedValue(mockEvaluateResult),
        close: jest.fn(),
      };

      const { launch } = require('puppeteer');
      launch.mockResolvedValueOnce({
        newPage: jest.fn().mockResolvedValue(mockPage),
        close: jest.fn(),
      });

      const result = await scraper.scrapePoolDetail('ethereum-aave-usdc');

      expect(result).toBeDefined();
      expect(result.pool).toBeDefined();
      expect(result.outlook).toBeDefined();
    });

    it('should return empty result for non-existent pool', async () => {
      const mockPage = {
        setUserAgent: jest.fn(),
        setViewport: jest.fn(),
        setRequestInterception: jest.fn(),
        on: jest.fn(),
        goto: jest.fn().mockRejectedValue(new Error('Page not found')),
        waitForSelector: jest.fn(),
        evaluate: jest.fn(),
        close: jest.fn(),
      };

      const { launch } = require('puppeteer');
      launch.mockResolvedValueOnce({
        newPage: jest.fn().mockResolvedValue(mockPage),
        close: jest.fn(),
      });

      const result = await scraper.scrapePoolDetail('non-existent-pool');

      expect(result.pool).toBeNull();
      expect(result.outlook).toBeNull();
    });
  });

  describe('scrapeMultiplePools', () => {
    it('should scrape multiple pools in batch', async () => {
      const mockEvaluateResult = {
        name: 'Test Pool',
        chain: 'Ethereum',
        project: 'aave',
        apy: 3.5,
        tvl: 1000000,
        outlook: null,
        chartData: [],
      };

      const mockPage = {
        setUserAgent: jest.fn(),
        setViewport: jest.fn(),
        setRequestInterception: jest.fn(),
        on: jest.fn(),
        goto: jest.fn(),
        waitForSelector: jest.fn(),
        evaluate: jest.fn().mockResolvedValue(mockEvaluateResult),
        close: jest.fn(),
      };

      const { launch } = require('puppeteer');
      launch.mockResolvedValueOnce({
        newPage: jest.fn().mockResolvedValue(mockPage),
        close: jest.fn(),
      });

      const poolIds = ['pool-1', 'pool-2'];
      const results = await scraper.scrapeMultiplePools(poolIds);

      expect(results.size).toBe(2);
      expect(results.has('pool-1')).toBe(true);
      expect(results.has('pool-2')).toBe(true);
    });

    it('should handle partial failures gracefully', async () => {
      const mockPage = {
        setUserAgent: jest.fn(),
        setViewport: jest.fn(),
        setRequestInterception: jest.fn(),
        on: jest.fn(),
        goto: jest.fn().mockRejectedValue(new Error('Network error')),
        waitForSelector: jest.fn(),
        evaluate: jest.fn(),
        close: jest.fn(),
      };

      const { launch } = require('puppeteer');
      launch.mockResolvedValueOnce({
        newPage: jest.fn().mockResolvedValue(mockPage),
        close: jest.fn(),
      });

      const poolIds = ['pool-1', 'pool-2'];
      const results = await scraper.scrapeMultiplePools(poolIds);

      expect(results.size).toBe(2);
      // Both should have null pools due to error
      expect(results.get('pool-1')?.pool).toBeNull();
    });
  });

  describe('rate limiting', () => {
    it('should enforce rate limits between requests', async () => {
      const mockPage = {
        setUserAgent: jest.fn(),
        setViewport: jest.fn(),
        setRequestInterception: jest.fn(),
        on: jest.fn(),
        goto: jest.fn(),
        waitForSelector: jest.fn(),
        evaluate: jest.fn().mockResolvedValue({
          name: 'Test',
          chain: 'Ethereum',
          project: 'aave',
          apy: 3.5,
          tvl: 1000000,
          outlook: null,
          chartData: [],
        }),
        close: jest.fn(),
      };

      const { launch } = require('puppeteer');
      launch.mockResolvedValueOnce({
        newPage: jest.fn().mockResolvedValue(mockPage),
        close: jest.fn(),
      });

      const startTime = Date.now();
      await scraper.scrapePoolDetail('pool-1');
      await scraper.scrapePoolDetail('pool-2');
      const elapsed = Date.now() - startTime;

      // Should have waited between requests
      expect(elapsed).toBeGreaterThanOrEqual(100);
    });
  });

  describe('captured requests', () => {
    it('should return captured API requests', () => {
      const requests = scraper.getCapturedRequests();
      expect(Array.isArray(requests)).toBe(true);
    });

    it('should clear captured requests', () => {
      scraper.clearCapturedRequests();
      const requests = scraper.getCapturedRequests();
      expect(requests).toHaveLength(0);
    });
  });

  describe('health check', () => {
    it('should return true when healthy', async () => {
      const mockPage = {
        setUserAgent: jest.fn(),
        setViewport: jest.fn(),
        setRequestInterception: jest.fn(),
        on: jest.fn(),
        goto: jest.fn(),
        waitForSelector: jest.fn(),
        evaluate: jest.fn().mockResolvedValue(true),
        close: jest.fn(),
      };

      const { launch } = require('puppeteer');
      launch.mockResolvedValueOnce({
        newPage: jest.fn().mockResolvedValue(mockPage),
        close: jest.fn(),
      });

      const healthy = await scraper.healthCheck();
      expect(healthy).toBe(true);
    });

    it('should return false when unhealthy', async () => {
      const { launch } = require('puppeteer');
      launch.mockRejectedValueOnce(new Error('Browser failed'));

      const healthy = await scraper.healthCheck();
      expect(healthy).toBe(false);
    });
  });

  describe('helper methods', () => {
    it('should identify stablecoins correctly', async () => {
      const stablecoins = ['USDC', 'USDT', 'DAI', 'sDAI', 'aDAI'];
      const nonStablecoins = ['ETH', 'WBTC', 'LINK', 'UNI'];

      // Test through the isStablecoin method indirectly via scrapeYieldsPage
      const mockResult = stablecoins.map((symbol, i) => ({
        id: `pool-${i}`,
        chain: 'Ethereum',
        project: 'test',
        symbol,
        apy: 3.0,
        tvlUsd: 1000000,
      }));

      const mockPage = {
        setUserAgent: jest.fn(),
        setViewport: jest.fn(),
        setRequestInterception: jest.fn(),
        on: jest.fn(),
        goto: jest.fn(),
        waitForSelector: jest.fn(),
        evaluate: jest.fn().mockResolvedValue(mockResult),
        close: jest.fn(),
      };

      const { launch } = require('puppeteer');
      launch.mockResolvedValueOnce({
        newPage: jest.fn().mockResolvedValue(mockPage),
        close: jest.fn(),
      });

      const result = await scraper.scrapeYieldsPage(YieldMode.STABLECOINS);

      // All should be identified as stablecoins
      expect(result.pools.every(p => p.stablecoin)).toBe(true);
    });
  });
});

/**
 * OPTIONAL SMOKE TEST
 * 
 * These tests perform real queries against DefiLlama.com.
 * Run with: RUN_SCRAPER_SMOKE_TEST=1 npm test -- scraper.test.ts
 * 
 * Purpose: Verify the scraper works against the actual website.
 * Note: Be respectful - only run occasionally and during off-peak hours.
 */
describe('DefiLlamaScraper - Smoke Tests (REAL QUERIES)', () => {
  // Only run if explicitly enabled
  const runSmokeTests = process.env.RUN_SCRAPER_SMOKE_TEST === '1';

  // Skip all tests if not explicitly enabled
  beforeAll(() => {
    if (!runSmokeTests) {
      console.log('\n⚠️  Skipping smoke tests. Set RUN_SCRAPER_SMOKE_TEST=1 to run real queries against DefiLlama.\n');
    }
  });

  // Real scraper instance (no mocking)
  let realScraper: DefiLlamaScraper;

  beforeEach(async () => {
    if (!runSmokeTests) return;
    
    // Create real scraper with conservative settings
    realScraper = new DefiLlamaScraper({
      headless: true,
      requestDelay: 3000, // 3 second delay between requests
      maxRequestsPerMinute: 10, // Very conservative
    });
  });

  afterEach(async () => {
    if (!runSmokeTests) return;
    await realScraper.close();
    // Wait between tests to be extra respectful
    await new Promise(resolve => setTimeout(resolve, 5000));
  });

  (runSmokeTests ? it : it.skip)('should connect to DefiLlama and scrape stablecoin yields', async () => {
    console.log('🔍 Smoke Test: Scraping stablecoin yields from DefiLlama.com...');
    
    const result = await realScraper.scrapeYieldsPage(YieldMode.STABLECOINS);
    
    // Verify we got data
    expect(result).toBeDefined();
    expect(result.pools).toBeDefined();
    expect(result.pools.length).toBeGreaterThan(0);
    
    // Verify pool structure
    const firstPool = result.pools[0];
    expect(firstPool.id).toBeDefined();
    expect(firstPool.chain).toBeDefined();
    expect(firstPool.project).toBeDefined();
    expect(firstPool.symbol).toBeDefined();
    expect(firstPool.apy).toBeGreaterThan(0);
    expect(firstPool.tvlUsd).toBeGreaterThan(0);
    
    console.log(`✅ Found ${result.pools.length} stablecoin pools`);
    console.log(`📊 Top pool: ${firstPool.project} ${firstPool.symbol} on ${firstPool.chain} - ${firstPool.apy.toFixed(2)}% APY, $${(firstPool.tvlUsd / 1e6).toFixed(2)}M TVL`);
  }, 60000); // 60 second timeout

  (runSmokeTests ? it : it.skip)('should scrape bluechip yields', async () => {
    console.log('🔍 Smoke Test: Scraping bluechip yields from DefiLlama.com...');
    
    const result = await realScraper.scrapeYieldsPage(YieldMode.BLUECHIPS);
    
    expect(result).toBeDefined();
    expect(result.pools.length).toBeGreaterThan(0);
    
    console.log(`✅ Found ${result.pools.length} bluechip pools`);
  }, 60000);

  (runSmokeTests ? it : it.skip)('should scrape hybrid stable+bluechip mode', async () => {
    console.log('🔍 Smoke Test: Scraping STABLE_BLUECHIPS yields...');
    
    const result = await realScraper.scrapeYieldsPage(YieldMode.STABLE_BLUECHIPS);
    
    expect(result).toBeDefined();
    expect(result.pools.length).toBeGreaterThan(0);
    
    console.log(`✅ Found ${result.pools.length} pools in hybrid mode`);
    
    // Show sample pools
    const samples = result.pools.slice(0, 3);
    samples.forEach(pool => {
      const type = pool.stablecoin ? 'stable' : 'bluechip';
      console.log(`   - ${pool.project} ${pool.symbol} (${type}): ${pool.apy.toFixed(2)}%`);
    });
  }, 60000);

  (runSmokeTests ? it : it.skip)('should scrape a specific pool detail page', async () => {
    // This test scrapes a known stablecoin pool
    // Using a popular USDC pool as example
    const testPoolId = 'd4b3c522-6127-4b89-bedf-83641cdcd2eb'; // Known Aave USDC pool
    
    console.log(`🔍 Smoke Test: Scraping pool detail for ${testPoolId}...`);
    
    const result = await realScraper.scrapePoolDetail(testPoolId);
    
    expect(result).toBeDefined();
    expect(result.pool).toBeDefined();
    expect(result.pool?.id).toBe(testPoolId);
    expect(result.chartData).toBeDefined();
    
    // Chart data may or may not be available depending on the pool
    if (result.chartData && result.chartData.length > 0) {
      console.log(`✅ Got chart data with ${result.chartData.length} data points`);
      const firstPoint = result.chartData[0];
      console.log(`   Sample: ${firstPoint.date} - APY: ${firstPoint.apy.toFixed(2)}%`);
    } else {
      console.log('⚠️  No chart data available (pool may be inactive or data format changed)');
    }
    
    // Check for Outlook prediction
    if (result.outlook) {
      console.log(`✅ Got Outlook prediction: ${result.outlook.timeframe}`);
      console.log(`   Current APY: ${result.outlook.currentApy.toFixed(2)}%`);
      console.log(`   Predicted range: ${result.outlook.predictedMinApy.toFixed(2)}% - ${(result.outlook.predictedMaxApy || result.outlook.predictedMinApy * 1.2).toFixed(2)}%`);
      console.log(`   Confidence: ${result.outlook.confidence}`);
    } else {
      console.log('ℹ️  No Outlook prediction available');
    }
  }, 60000);

  (runSmokeTests ? it : it.skip)('should respect rate limiting', async () => {
    console.log('🔍 Smoke Test: Verifying rate limiting...');
    
    const startTime = Date.now();
    
    // Make multiple requests
    await realScraper.scrapeYieldsPage(YieldMode.STABLECOINS);
    await realScraper.scrapeYieldsPage(YieldMode.BLUECHIPS);
    
    const elapsed = Date.now() - startTime;
    
    // With 3 second delay between requests, should take at least 3 seconds
    expect(elapsed).toBeGreaterThan(2000);
    
    console.log(`✅ Rate limiting working: ${elapsed}ms elapsed for 2 requests`);
  }, 120000);
});
