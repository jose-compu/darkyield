import axios, { AxiosInstance } from 'axios';
import { logger } from '../utils/logger.js';

interface CoinGeckoCoin {
  id: string;
  symbol: string;
  name: string;
  market_cap_rank: number;
  market_cap: number;
  current_price: number;
}

interface CoinGeckoMarketRow extends CoinGeckoCoin {
  price_change_percentage_24h?: number | null;
}

interface ApiHealthStatus {
  isHealthy: boolean;
  lastSuccess: Date | null;
  lastError: Date | null;
  consecutiveFailures: number;
  totalRequests: number;
  rateLimitHits: number;
}

function parseEnvMs(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Shared top-200 + meme discovery (one refresh updates both). */
const CATALOG_TTL_MS = parseEnvMs('COINGECKO_CATALOG_TTL_MS', 6 * 60 * 60 * 1000);
/** Minimum pause after each HTTP response before the next CoinGecko call. */
const MIN_HTTP_GAP_MS = parseEnvMs('COINGECKO_HTTP_GAP_MS', 4000);

let globalBackoffUntil = 0;

interface CatalogState {
  top200: Set<string>;
  memeDiscovery: Set<string>;
  marketRows: CoinGeckoCoin[];
  time: number;
}

let catalog: CatalogState | null = null;
let syncInFlight: Promise<void> | null = null;

// Legacy mirrors (some code paths read these via getUsageStats)
let top200Symbols: Set<string> = new Set();
let lastFetchTime = 0;

let memeDiscoveryCache: { symbols: Set<string>; time: number } | null = null;

// Token volatility cache
interface VolatilityCache {
  volatility: number;
  timestamp: number;
  tokenId: string;
}
const tokenVolatilityCache = new Map<string, VolatilityCache>();
const VOLATILITY_CACHE_TTL = 30 * 60 * 1000;

// Symbol → CoinGecko id (from /coins/list)
const tokenIdCache = new Map<string, string>();
let coinsListLoadedAt = 0;
const COINS_LIST_TTL_MS = parseEnvMs('COINGECKO_COINS_LIST_TTL_MS', 48 * 60 * 60 * 1000);

const healthStatus: ApiHealthStatus = {
  isHealthy: true,
  lastSuccess: null,
  lastError: null,
  consecutiveFailures: 0,
  totalRequests: 0,
  rateLimitHits: 0,
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class CoinGeckoService {
  private client: AxiosInstance;
  /** Serializes all CoinGecko HTTP so we never burst the free tier. */
  private httpChain: Promise<void> = Promise.resolve();
  private lastHttpDoneAt = 0;

  constructor() {
    const apiKey = process.env.COINGECKO_API_KEY?.trim();
    this.client = axios.create({
      baseURL: 'https://api.coingecko.com/api/v3',
      timeout: 30000,
      headers: {
        Accept: 'application/json',
        ...(apiKey ? { 'x-cg-pro-api-key': apiKey } : {}),
      },
    });

    this.client.interceptors.response.use(
      (response) => {
        healthStatus.lastSuccess = new Date();
        healthStatus.consecutiveFailures = 0;
        healthStatus.isHealthy = true;
        return response;
      },
      (error) => {
        healthStatus.lastError = new Date();
        healthStatus.consecutiveFailures++;

        if (error.response?.status === 429) {
          healthStatus.rateLimitHits++;
          healthStatus.isHealthy = false;
          const ra = error.response.headers?.['retry-after'];
          const sec = ra ? Math.min(parseInt(String(ra), 10) || 60, 300) : 90;
          globalBackoffUntil = Math.max(globalBackoffUntil, Date.now() + sec * 1000 + 2000);
          logger.warn('CoinGecko rate limit hit - backing off', {
            rateLimitHits: healthStatus.rateLimitHits,
            retryAfterSec: sec,
            backoffUntil: new Date(globalBackoffUntil).toISOString(),
          });
        }

        if (healthStatus.consecutiveFailures >= 3) {
          healthStatus.isHealthy = false;
        }

        return Promise.reject(error);
      }
    );
  }

  private isPublicCatalogEnabled(): boolean {
    return process.env.COINGECKO_PUBLIC !== 'false';
  }

  /**
   * Run one CoinGecko HTTP call after respecting global gap + 429 backoff.
   * All reads go through this so we never parallel-burst the API.
   */
  private async httpGet<T>(url: string, params?: Record<string, unknown>): Promise<{ data: T }> {
    const op = this.httpChain.then(async () => {
      if (Date.now() < globalBackoffUntil) {
        throw new Error('CoinGecko: in rate-limit backoff');
      }
      const gap = Math.max(0, MIN_HTTP_GAP_MS - (Date.now() - this.lastHttpDoneAt));
      if (gap > 0) {
        await sleep(gap);
      }
      try {
        const res = await this.client.get<T>(url, { params });
        this.lastHttpDoneAt = Date.now();
        healthStatus.totalRequests++;
        return res;
      } catch (e) {
        this.lastHttpDoneAt = Date.now();
        throw e;
      }
    });
    this.httpChain = op.then(
      () => sleep(0),
      () => sleep(0)
    );
    return op;
  }

  private addMemeStyleSymbol(merged: Set<string>, sym: string | undefined): void {
    if (!sym || sym.length < 2) return;
    let s = sym.toUpperCase().trim().replace(/^[\d.]+/, '');
    merged.add(s);
    if (s.startsWith('W') && s.length > 3) merged.add(s.slice(1));
  }

  /** At most 2 HTTP calls per TTL: main markets + meme category. */
  private async fetchAndMergeCatalog(): Promise<void> {
    const merged = new Set<string>();

    const main = await this.httpGet<CoinGeckoMarketRow[]>('/coins/markets', {
      vs_currency: 'usd',
      order: 'market_cap_desc',
      per_page: 250,
      page: 1,
      sparkline: false,
      price_change_percentage: '24h',
    });

    const rows = main.data || [];
    const top200 = new Set(rows.slice(0, 200).map((c) => c.symbol.toUpperCase()));

    const sortedGain = [...rows].sort(
      (a, b) =>
        (b.price_change_percentage_24h ?? -Infinity) - (a.price_change_percentage_24h ?? -Infinity)
    );
    for (let i = 0; i < 50 && i < sortedGain.length; i++) {
      this.addMemeStyleSymbol(merged, sortedGain[i].symbol);
    }
    const sortedLose = [...rows].sort(
      (a, b) =>
        (a.price_change_percentage_24h ?? Infinity) - (b.price_change_percentage_24h ?? Infinity)
    );
    for (let i = 0; i < 50 && i < sortedLose.length; i++) {
      this.addMemeStyleSymbol(merged, sortedLose[i].symbol);
    }

    try {
      const meme = await this.httpGet<CoinGeckoMarketRow[]>('/coins/markets', {
        vs_currency: 'usd',
        category: 'meme-token',
        order: 'market_cap_desc',
        per_page: 100,
        page: 1,
        sparkline: false,
      });
      for (const row of meme.data || []) {
        this.addMemeStyleSymbol(merged, row.symbol);
      }
    } catch (e) {
      logger.warn('CoinGecko meme-token category fetch failed', { error: (e as Error).message });
    }

    const now = Date.now();
    catalog = {
      top200,
      memeDiscovery: merged,
      marketRows: rows,
      time: now,
    };
    top200Symbols = top200;
    lastFetchTime = now;
    memeDiscoveryCache = { symbols: merged, time: now };

    logger.info('CoinGecko catalog synced (shared top-200 + meme discovery)', {
      top200: top200.size,
      memeDiscovery: merged.size,
    });
  }

  private async syncPublicCatalogIfStale(): Promise<void> {
    if (!this.isPublicCatalogEnabled()) return;
    if (catalog && Date.now() - catalog.time < CATALOG_TTL_MS) return;
    if (Date.now() < globalBackoffUntil) {
      logger.debug('CoinGecko catalog skip: backoff active');
      return;
    }

    if (!syncInFlight) {
      syncInFlight = (async () => {
        try {
          await this.fetchAndMergeCatalog();
        } catch (e) {
          const msg = (e as Error).message;
          if (msg.includes('backoff')) {
            logger.debug('CoinGecko catalog sync skipped during backoff');
          } else {
            logger.warn('CoinGecko catalog sync failed', { error: msg });
          }
          if (top200Symbols.size === 0) {
            logger.warn('CoinGecko fetch failed on first attempt - using fallback bluechip list');
            top200Symbols = this.getFallbackTop200Symbols();
            lastFetchTime = Date.now();
          }
          if (!memeDiscoveryCache) {
            memeDiscoveryCache = { symbols: new Set(), time: Date.now() };
          }
        } finally {
          syncInFlight = null;
        }
      })();
    }
    await syncInFlight;
  }

  async fetchTop200Coins(): Promise<CoinGeckoCoin[]> {
    await this.syncPublicCatalogIfStale();
    if (catalog?.marketRows?.length) {
      return catalog.marketRows.slice(0, 200);
    }
    return [];
  }

  async getTop200Symbols(): Promise<Set<string>> {
    await this.syncPublicCatalogIfStale();

    if (top200Symbols.size > 0) {
      return top200Symbols;
    }

    if (!healthStatus.isHealthy && healthStatus.consecutiveFailures >= 5) {
      logger.warn('CoinGecko API appears unhealthy - using fallback data');
      return top200Symbols.size > 0 ? top200Symbols : this.getFallbackTop200Symbols();
    }

    if (top200Symbols.size === 0) {
      top200Symbols = this.getFallbackTop200Symbols();
      lastFetchTime = Date.now();
    }

    return top200Symbols;
  }

  private getFallbackTop200Symbols(): Set<string> {
    const fallbackSymbols = [
      'BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'USDC', 'USDT', 'ADA', 'AVAX', 'DOGE',
      'TRX', 'DOT', 'LINK', 'TON', 'MATIC', 'POL', 'ICP', 'SHIB', 'DAI', 'LTC',
      'BCH', 'UNI', 'LEO', 'ATOM', 'XLM', 'OKB', 'ETC', 'XMR', 'APT', 'NEAR',
      'IMX', 'TAO', 'HBAR', 'CRO', 'FIL', 'MNT', 'ARB', 'STX', 'VET', 'MKR',
      'WIF', 'SUI', 'FTM', 'OP', 'INJ', 'THETA', 'RUNE', 'GRT', 'FET', 'SEI',
      'WLD', 'LDO', 'JUP', 'AR', 'PEOPLE', 'ALT', 'PENDLE', 'STRK', 'DYM',
      'SAND', 'MANA', 'AXS', 'GALA', 'CHZ', 'ENJ', 'PEPE', 'FLOKI', 'BONK',
      'PYTH', 'JTO', 'BOME', 'AAVE', 'CRV', 'CVX', 'SNX', 'YFI', 'COMP', 'BAL',
      'SUSHI', '1INCH', 'DYDX', 'GMX', 'GNS', 'LRC', 'ZRX', 'RPL', 'ETHFI', 'ENS',
    ];
    return new Set(fallbackSymbols);
  }

  async isTop200(symbol: string): Promise<boolean> {
    const top200 = await this.getTop200Symbols();
    return top200.has(symbol.toUpperCase());
  }

  async getTop200CoinData(): Promise<Map<string, CoinGeckoCoin>> {
    const coins = await this.fetchTop200Coins();
    const coinMap = new Map<string, CoinGeckoCoin>();
    for (const coin of coins) {
      coinMap.set(coin.symbol.toUpperCase(), coin);
      coinMap.set(coin.id.toLowerCase(), coin);
    }
    return coinMap;
  }

  getHealthStatus(): ApiHealthStatus {
    return { ...healthStatus };
  }

  async healthCheck(): Promise<{ healthy: boolean; message: string }> {
    try {
      if (Date.now() < globalBackoffUntil) {
        return {
          healthy: false,
          message: `CoinGecko in backoff until ${new Date(globalBackoffUntil).toISOString()}`,
        };
      }
      await this.httpGet('/ping');
      return {
        healthy: true,
        message: 'CoinGecko API is responsive',
      };
    } catch (error) {
      const axiosError = error as { message?: string; response?: { status?: number } };
      return {
        healthy: false,
        message: `CoinGecko API check failed: ${axiosError.message} (status: ${axiosError.response?.status || 'unknown'})`,
      };
    }
  }

  getUsageStats(): {
    cacheAge: number;
    cachedSymbols: number;
    totalRequests: number;
    rateLimitHits: number;
    isHealthy: boolean;
  } {
    return {
      cacheAge: lastFetchTime ? Math.round((Date.now() - lastFetchTime) / 1000 / 60) : -1,
      cachedSymbols: top200Symbols.size,
      totalRequests: healthStatus.totalRequests,
      rateLimitHits: healthStatus.rateLimitHits,
      isHealthy: healthStatus.isHealthy,
    };
  }

  /** Load full coin list at most once per COINS_LIST_TTL_MS (heavy; used for volatility IDs). */
  private async ensureCoinsList(): Promise<void> {
    if (Date.now() - coinsListLoadedAt < COINS_LIST_TTL_MS && tokenIdCache.size > 0) {
      return;
    }
    if (Date.now() < globalBackoffUntil) return;

    const res = await this.httpGet<Array<{ id: string; symbol: string; name: string }>>('/coins/list', {
      include_platform: false,
    });
    tokenIdCache.clear();
    for (const c of res.data || []) {
      tokenIdCache.set(c.symbol.toUpperCase(), c.id);
    }
    coinsListLoadedAt = Date.now();
  }

  private calculateVolatility(prices: Array<[number, number]>): number {
    if (prices.length < 2) return 0;
    const returns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      const prevPrice = prices[i - 1][1];
      const currPrice = prices[i][1];
      const dailyReturn = (currPrice - prevPrice) / prevPrice;
      returns.push(dailyReturn);
    }
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
    const dailyStd = Math.sqrt(variance);
    const annualizedVol = dailyStd * Math.sqrt(365);
    return annualizedVol * 100;
  }

  /**
   * Optional: 30d chart volatility (heavy). Off by default — set COINGECKO_VOLATILITY_CHART=true to enable.
   */
  async getTokenVolatility(symbol: string): Promise<number | null> {
    const allowChart =
      process.env.COINGECKO_VOLATILITY_CHART === 'true' || process.env.COINGECKO_VOLATILITY_CHART === '1';
    if (!allowChart) {
      const cached = tokenVolatilityCache.get(symbol.toUpperCase());
      return cached?.volatility ?? null;
    }

    const upperSymbol = symbol.toUpperCase();
    const now = Date.now();
    const cached = tokenVolatilityCache.get(upperSymbol);
    if (cached && now - cached.timestamp < VOLATILITY_CACHE_TTL) {
      logger.debug('Returning cached volatility', { symbol: upperSymbol, volatility: cached.volatility });
      return cached.volatility;
    }

    if (Date.now() < globalBackoffUntil) {
      return cached?.volatility ?? null;
    }

    try {
      await this.ensureCoinsList();
      const tokenId = tokenIdCache.get(upperSymbol) ?? null;
      if (!tokenId) {
        logger.debug('Could not find CoinGecko ID for token', { symbol: upperSymbol });
        return null;
      }

      const response = await this.httpGet<{ prices: Array<[number, number]> }>(
        `/coins/${tokenId}/market_chart`,
        {
          vs_currency: 'usd',
          days: 30,
          interval: 'daily',
        }
      );

      const prices: Array<[number, number]> = response.data?.prices || [];
      if (prices.length < 7) {
        logger.debug('Insufficient price data for volatility calculation', {
          symbol: upperSymbol,
          dataPoints: prices.length,
        });
        return null;
      }

      const volatility = this.calculateVolatility(prices);
      tokenVolatilityCache.set(upperSymbol, {
        volatility,
        timestamp: now,
        tokenId,
      });
      return volatility;
    } catch (error) {
      const axiosError = error as { response?: { status?: number }; message?: string };
      if (axiosError.response?.status === 429) {
        logger.warn('Rate limit hit while fetching token volatility', { symbol: upperSymbol });
      } else {
        logger.debug('Failed to fetch token volatility', {
          symbol: upperSymbol,
          error: axiosError.message,
          status: axiosError.response?.status,
        });
      }
      return cached?.volatility ?? null;
    }
  }

  async getPoolVolatility(tokens: string[]): Promise<number | null> {
    if (!tokens || tokens.length === 0) return null;

    const volatilities: number[] = [];
    const stablecoins = ['USDC', 'USDT', 'DAI', 'BUSD', 'TUSD', 'USDD', 'USDP', 'GUSD', 'FRAX', 'LUSD'];

    for (const token of tokens) {
      if (stablecoins.includes(token.toUpperCase())) continue;
      const vol = await this.getTokenVolatility(token);
      if (vol !== null) volatilities.push(vol);
    }

    if (volatilities.length === 0) return null;
    return volatilities.reduce((sum, v) => sum + v, 0) / volatilities.length;
  }

  /**
   * Meme-style symbols for discovery (same refresh as top-200 — no extra burst).
   */
  async getMemeDiscoverySymbols(): Promise<Set<string>> {
    await this.syncPublicCatalogIfStale();
    if (memeDiscoveryCache && memeDiscoveryCache.symbols.size > 0) {
      return memeDiscoveryCache.symbols;
    }
    return new Set<string>();
  }

  clearCache(): void {
    top200Symbols.clear();
    lastFetchTime = 0;
    this.lastHttpDoneAt = 0;
    healthStatus.consecutiveFailures = 0;
    healthStatus.isHealthy = true;
    tokenVolatilityCache.clear();
    tokenIdCache.clear();
    coinsListLoadedAt = 0;
    memeDiscoveryCache = null;
    catalog = null;
    globalBackoffUntil = 0;
    logger.info('CoinGecko cache and stats cleared');
  }
}

export const coinGeckoService = new CoinGeckoService();
