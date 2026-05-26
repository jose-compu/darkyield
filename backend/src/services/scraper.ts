import puppeteer, { Browser, Page, HTTPRequest, HTTPResponse } from 'puppeteer';
import { 
  Pool, 
  APYPrediction,
  YieldMode,
} from '../../../shared/types/index.js';
import { logger } from '../utils/logger.js';

interface ScrapedPoolData {
  pools: Pool[];
  apiResponses: any[];
  timestamp: Date;
}

interface PoolDetailData {
  pool: Pool | null;
  outlook: APYPrediction | null;
  chartData: Array<{ date: string; apy: number; tvl: number }>;
  apiResponses: any[];
}

interface ScrapingConfig {
  headless: boolean;
  slowMo: number;
  requestDelay: number;
  maxRequestsPerMinute: number;
  userAgent: string;
}

interface CapturedRequest {
  url: string;
  method: string;
  responseBody?: any;
  timestamp: Date;
}

export class DefiLlamaScraper {
  private browser: Browser | null = null;
  private config: ScrapingConfig;
  private requestCount: number = 0;
  private lastRequestTime: number = 0;
  private capturedRequests: CapturedRequest[] = [];

  constructor(config: Partial<ScrapingConfig> = {}) {
    this.config = {
      headless: true,
      slowMo: 100,
      requestDelay: 2000, // 2 seconds between requests
      maxRequestsPerMinute: 10, // Conservative limit
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      ...config,
    };
  }

  // Initialize browser
  async init(): Promise<void> {
    if (this.browser) return;

    try {
      this.browser = await puppeteer.launch({
        headless: this.config.headless,
        slowMo: this.config.slowMo,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--window-size=1920,1080',
        ],
      });

      logger.info('DefiLlama scraper initialized');
    } catch (error) {
      logger.error('Failed to initialize scraper', error as Error);
      throw error;
    }
  }

  // Close browser
  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      logger.info('DefiLlama scraper closed');
    }
  }

  // Rate limiting check
  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.config.requestDelay) {
      const waitTime = this.config.requestDelay - timeSinceLastRequest;
      logger.debug(`Rate limiting: waiting ${waitTime}ms`);
      await this.sleep(waitTime);
    }

    // Check per-minute limit
    if (this.requestCount >= this.config.maxRequestsPerMinute) {
      const waitTime = 60000 - timeSinceLastRequest;
      if (waitTime > 0) {
        logger.info(`Rate limit reached, waiting ${Math.ceil(waitTime / 1000)}s`);
        await this.sleep(waitTime);
        this.requestCount = 0;
      }
    }

    this.lastRequestTime = Date.now();
    this.requestCount++;
  }

  // Sleep helper
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Create new page with interception setup
  private async createPage(): Promise<Page> {
    if (!this.browser) {
      throw new Error('Browser not initialized');
    }

    const page = await this.browser.newPage();
    
    // Set user agent
    await page.setUserAgent(this.config.userAgent);
    
    // Set viewport
    await page.setViewport({ width: 1920, height: 1080 });
    
    // Enable request interception to capture API calls
    await page.setRequestInterception(true);
    
    page.on('request', (request: HTTPRequest) => {
      // Continue all requests but capture API calls
      const url = request.url();
      
      // Capture LLAMA API calls
      if (url.includes('llama.fi') || url.includes('defillama.com')) {
        this.capturedRequests.push({
          url,
          method: request.method(),
          timestamp: new Date(),
        });
      }
      
      request.continue();
    });

    page.on('response', async (response: HTTPResponse) => {
      const url = response.url();
      
      // Capture LLAMA API responses
      if (url.includes('llama.fi') || url.includes('defillama.com')) {
        try {
          // Try to get response body
          const contentType = response.headers()['content-type'] || '';
          if (contentType.includes('application/json')) {
            const body = await response.json().catch(() => null);
            if (body) {
              const captured = this.capturedRequests.find(r => r.url === url);
              if (captured) {
                captured.responseBody = body;
              }
            }
          }
        } catch (error) {
          // Ignore response capture errors
        }
      }
    });

    return page;
  }

  // Scrape main yields page
  async scrapeYieldsPage(mode: YieldMode = YieldMode.STABLECOINS): Promise<ScrapedPoolData> {
    await this.init();
    await this.enforceRateLimit();

    const page = await this.createPage();
    this.capturedRequests = []; // Reset captures

    try {
      logger.info('Scraping DefiLlama yields page', { mode });

      // Navigate to yields page
      const url = `https://defillama.com/yields${mode === YieldMode.STABLECOINS ? '?token=ALL_USD_STABLES' : ''}`;
      
      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: 60000,
      });

      // Wait for the table to load
      await page.waitForSelector('table tbody tr', { timeout: 30000 });

      // Wait a bit more for any lazy-loaded data
      await this.sleep(2000);

      // Extract pool data from the page
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pools = await page.evaluate((): any[] => {
        const rows = document.querySelectorAll('table tbody tr');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data: any[] = [];

        rows.forEach((row: Element) => {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 5) {
            // Extract pool ID from the row or link
            const link = row.querySelector('a[href*="/yields/pool/"]');
            const poolId = link?.getAttribute('href')?.split('/').pop() || '';

            // Get chain from the row
            const chainImg = row.querySelector('td:first-child img');
            const chain = chainImg?.getAttribute('alt') || '';

            // Get project name
            const projectEl = row.querySelector('td:nth-child(2)');
            const project = projectEl?.textContent?.trim() || '';

            // Get pool name/symbol
            const symbolEl = row.querySelector('td:nth-child(3)');
            const symbol = symbolEl?.textContent?.trim() || '';

            // Get APY
            const apyEl = row.querySelector('td:nth-child(4)');
            const apyText = apyEl?.textContent?.replace('%', '').trim() || '0';
            const apy = parseFloat(apyText) || 0;

            // Get TVL
            const tvlEl = row.querySelector('td:nth-child(5)');
            const tvlText = tvlEl?.textContent?.replace(/[$,]/g, '').trim() || '0';
            const tvl = parseFloat(tvlText) || 0;

            if (poolId && symbol) {
              data.push({
                id: poolId,
                chain,
                project,
                symbol,
                apy,
                tvlUsd: tvl * 1_000_000, // Convert from millions
              });
            }
          }
        });

        return data;
      });

      // Also capture any XHR/fetch data from the page
      const apiResponses = this.capturedRequests
        .filter(r => r.responseBody)
        .map(r => ({
          url: r.url,
          data: r.responseBody,
        }));

      logger.info('Scraped yields page', { 
        poolCount: pools.length,
        apiResponses: apiResponses.length,
      });

      return {
        pools: pools.map(p => this.transformToPool(p)),
        apiResponses,
        timestamp: new Date(),
      };
    } catch (error) {
      logger.error('Failed to scrape yields page', error as Error);
      throw error;
    } finally {
      await page.close();
    }
  }

  // Scrape individual pool page for Outlook predictions
  async scrapePoolDetail(poolId: string): Promise<PoolDetailData> {
    await this.init();
    await this.enforceRateLimit();

    const page = await this.createPage();
    this.capturedRequests = [];

    try {
      logger.info('Scraping pool detail page', { poolId });

      const url = `https://defillama.com/yields/pool/${poolId}`;
      
      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: 60000,
      });

      // Wait for page content
      await page.waitForSelector('h1', { timeout: 30000 });
      await this.sleep(2000);

      // Extract pool data
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const poolData = await page.evaluate(() => {
        const nameEl = document.querySelector('h1');
        const fullName = nameEl?.textContent?.trim() || '';

        const chainEl = document.querySelector('[data-testid="chain-badge"]');
        const chain = chainEl?.textContent?.trim() || '';

        const projectEl = document.querySelector('[data-testid="project-badge"]');
        const project = projectEl?.textContent?.trim() || '';

        const apyEl = document.querySelector('[data-testid="apy-value"]');
        const apyText = apyEl?.textContent?.replace('%', '').trim() || '0';
        const apy = parseFloat(apyText) || 0;

        const tvlEl = document.querySelector('[data-testid="tvl-value"]');
        const tvlText = tvlEl?.textContent?.replace(/[$,]/g, '').trim() || '0';
        const tvl = parseFloat(tvlText) * 1_000_000 || 0;

        // Extract Outlook prediction
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let outlook: any = null;
        const outlookEl = document.querySelector('[data-testid="outlook-section"]') || 
                          document.body.textContent?.includes('Outlook');
        
        if (outlookEl) {
          const allText = document.body.innerText;
          const outlookMatch = allText.match(/Outlook[\s\S]*?Confidence:\s*(Low|Medium|High)/i);
          
          if (outlookMatch) {
            const outlookText = outlookMatch[0];
            
            // Parse the outlook text
            const apyMatch = outlookText.match(/current APY of ([\d.]+)%/i);
            const minApyMatch = outlookText.match(/not fall below ([\d.]+)%/i);
            const timeframeMatch = outlookText.match(/within the next ([\d\s\w]+)/i);
            const confidenceMatch = outlookText.match(/Confidence:\s*(Low|Medium|High)/i);

            if (apyMatch && minApyMatch) {
              outlook = {
                currentApy: parseFloat(apyMatch[1]),
                predictedMinApy: parseFloat(minApyMatch[1]),
                timeframe: timeframeMatch ? timeframeMatch[1] : '4 weeks',
                confidence: confidenceMatch ? confidenceMatch[1].toUpperCase() : 'MEDIUM',
              };
            }
          }
        }

        // Extract chart data from any exposed variables or API responses
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let chartData: any[] = [];
        
        const scripts = document.querySelectorAll('script');
        scripts.forEach((script: Element) => {
          const text = script.textContent || '';
          
          // Look for chart data in script tags
          if (text.includes('chartData') || text.includes('__INITIAL_STATE__')) {
            try {
              const chartMatch = text.match(/chartData[:\s]*([\[{].*?[\]}])/);
              if (chartMatch) {
                const parsed = JSON.parse(chartMatch[1]);
                if (Array.isArray(parsed)) {
                  chartData = parsed;
                }
              }
            } catch (e) {
              // Ignore parsing errors
            }
          }
        });

        return {
          name: fullName,
          chain,
          project,
          apy,
          tvl,
          outlook,
          chartData,
        };
      });

      // Also try to find CSV download button and capture the URL
      const csvUrl = await page.evaluate(() => {
        const csvBtn = document.querySelector('a[href*=".csv"], button[data-testid="csv-download"]');
        return csvBtn?.getAttribute('href') || null;
      });

      if (csvUrl) {
        logger.info('Found CSV download URL', { csvUrl });
      }

      // Capture API responses that might contain chart data
      const chartApiResponses = this.capturedRequests
        .filter(r => r.url.includes('chart') && r.responseBody)
        .map(r => r.responseBody);

      // Transform pool data
      const pool: Pool = {
        id: poolId,
        chain: poolData.chain || 'Unknown',
        project: poolData.project || 'Unknown',
        symbol: poolData.name || 'Unknown',
        tvlUsd: poolData.tvl,
        apyBase: poolData.apy,
        apyReward: 0,
        apy: poolData.apy,
        stablecoin: this.isStablecoin(poolData.name),
        ilRisk: 'no',
        exposure: 'single',
        lastUpdated: new Date(),
      };

      // Transform outlook
      const outlook: APYPrediction | null = poolData.outlook ? {
        currentApy: poolData.outlook.currentApy,
        predictedMinApy: poolData.outlook.predictedMinApy,
        confidence: poolData.outlook.confidence as 'LOW' | 'MEDIUM' | 'HIGH',
        timeframe: poolData.outlook.timeframe,
        expiresAt: new Date(Date.now() + 28 * 24 * 60 * 60 * 1000),
      } : null;

      return {
        pool,
        outlook,
        chartData: poolData.chartData,
        apiResponses: chartApiResponses,
      };
    } catch (error) {
      logger.error('Failed to scrape pool detail', error as Error, { poolId });
      return {
        pool: null,
        outlook: null,
        chartData: [],
        apiResponses: [],
      };
    } finally {
      await page.close();
    }
  }

  // Download CSV chart data for a pool
  async downloadChartCSV(poolId: string): Promise<{ data: string; filename: string } | null> {
    await this.init();
    await this.enforceRateLimit();

    const page = await this.createPage();

    try {
      logger.info('Attempting CSV download', { poolId });

      const url = `https://defillama.com/yields/pool/${poolId}`;
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

      // Look for CSV download link
      const csvUrl = await page.evaluate((): string | null => {
        const links = document.querySelectorAll('a');
        // Convert NodeList to Array for iteration
        const linksArray = Array.from(links);
        for (const link of linksArray) {
          const href = link.getAttribute('href') || '';
          if (href.includes('.csv') || href.includes('download')) {
            return href;
          }
        }
        return null;
      });

      if (csvUrl) {
        // Construct full URL
        const fullUrl = csvUrl.startsWith('http') ? csvUrl : `https://defillama.com${csvUrl}`;
        
        // Download CSV content
        const response = await page.evaluate(async (url) => {
          const res = await fetch(url);
          return res.text();
        }, fullUrl);

        return {
          data: response,
          filename: `defillama-yield-${poolId}.csv`,
        };
      }

      return null;
    } catch (error) {
      logger.error('Failed to download CSV', error as Error, { poolId });
      return null;
    } finally {
      await page.close();
    }
  }

  // Get captured API responses from the last scrape
  getCapturedRequests(): CapturedRequest[] {
    return [...this.capturedRequests];
  }

  // Clear captured requests
  clearCapturedRequests(): void {
    this.capturedRequests = [];
  }

  // Helper: Transform scraped data to Pool format
  private transformToPool(data: any): Pool {
    return {
      id: data.id || `${data.chain}-${data.project}-${data.symbol}`,
      chain: data.chain || 'Unknown',
      project: data.project || 'Unknown',
      symbol: data.symbol || 'Unknown',
      tvlUsd: data.tvlUsd || 0,
      apyBase: data.apy || 0,
      apyReward: 0,
      apy: data.apy || 0,
      stablecoin: this.isStablecoin(data.symbol),
      ilRisk: 'no',
      exposure: 'single',
      lastUpdated: new Date(),
    };
  }

  // Helper: Check if symbol is likely a stablecoin
  private isStablecoin(symbol: string): boolean {
    const stablecoinPatterns = [
      /USDC?/i, /USDT?/i, /DAI/i, /BUSD/i, /FRAX/i, /TUSD/i,
      /GUSD/i, /PAX/i, /USDP/i, /SUSD/i, /LUSD/i, /crvUSD/i,
      /sDAI/i, /aDAI/i, /cUSDC/i, /cDAI/i,
    ];
    
    return stablecoinPatterns.some(pattern => pattern.test(symbol));
  }

  // Scrape multiple pools with delay
  async scrapeMultiplePools(poolIds: string[]): Promise<Map<string, PoolDetailData>> {
    const results = new Map<string, PoolDetailData>();

    for (const poolId of poolIds) {
      try {
        const data = await this.scrapePoolDetail(poolId);
        results.set(poolId, data);
        
        // Add extra delay between pools to be respectful
        if (poolIds.indexOf(poolId) < poolIds.length - 1) {
          await this.sleep(this.config.requestDelay * 2);
        }
      } catch (error) {
        logger.error('Failed to scrape pool', error as Error, { poolId });
        results.set(poolId, { pool: null, outlook: null, chartData: [], apiResponses: [] });
      }
    }

    return results;
  }

  // Health check
  async healthCheck(): Promise<boolean> {
    try {
      await this.init();
      const page = await this.createPage();
      await page.goto('https://defillama.com/yields', { timeout: 30000 });
      const isLoaded = await page.evaluate((): boolean => {
        return document.readyState === 'complete';
      });
      await page.close();
      return isLoaded;
    } catch (error) {
      logger.error('Health check failed', error as Error);
      return false;
    }
  }
}

// Singleton instance
export const defiLlamaScraper = new DefiLlamaScraper();
