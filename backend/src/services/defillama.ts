import axios, { AxiosInstance } from 'axios';
import { 
  Pool, 
  Chain, 
  Protocol, 
  YieldFilter, 
  YieldMode, 
  RiskLevel,
  APYPrediction,
  HistoricalDataPoint,
} from '../../../shared/types/index.js';
import { config, STABLECOIN_SYMBOLS, CHAIN_IDS, isEvmCompatibleLlamaChain } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { defiLlamaScraper } from './scraper.js';
import { coinGeckoService } from './coingecko.js';
import { enrichPoolsWithDepositPauseFlags } from './etherscanVaultPause.js';

/** Known meme / animal-coin tickers (uppercase roots). Used to route pools to MEMECOINS and exclude them from bluechip/long-tail. */
const MEMECOIN_SYMBOLS = new Set<string>([
  'PEPE', 'DOGE', 'SHIB', 'FLOKI', 'BONK', 'WIF', 'BOME', 'MEW', 'MOG', 'POPCAT',
  'TURBO', 'BRETT', 'DEGEN', 'MYRO', 'NEIRO', 'ELON', 'SAMO', 'MEME', 'LADYS',
  'WOJAK', 'TROLL', 'COQ', 'PNUT', 'GOAT', 'CHILLGUY', 'ACT', 'HMSTR', 'FWOG',
  'BABYDOGE', 'CHEEMS', 'KEKE', 'PONKE', 'MOCHI', 'HOSKY', 'KISHU', 'AIDOGE',
  'SLERF', 'MOTHER', 'GIGA', 'RATS', 'SILLY', 'HOPPY', 'MUMU', 'PORK', 'SMOLE',
  'WEN', 'SNEK', 'WOOF', 'DOBO', 'DOGS', 'NOT', 'BAN', 'MICHI', 'SORA', 'NEIROCTO',
  '1000PEPE', '1000SATS', '1000BONK', '1000RATS',
]);

interface DefiLlamaPool {
  chain: string;
  project: string;
  symbol: string;
  tvlUsd: number;
  apyBase?: number;
  apyReward?: number;
  apy?: number;
  apyBase7d?: number;
  apyMean30d?: number;
  stablecoin: boolean;
  ilRisk: 'yes' | 'no' | 'medium' | 'high';
  exposure: 'single' | 'multi';
  underlyingTokens?: string[];
  rewardTokens?: string[];
  pool?: string;
  poolMeta?: string;
  url?: string;
  apyPct1D?: number;
  apyPct7D?: number;
  apyPct30D?: number;
  mu?: number; // mean APY for predictions
  sigma?: number; // volatility
  count?: number;
  outlier?: boolean;
  Predictions?: {
    predictedClass: string;
    predictedProbability: number;
    binnedConfidence: number;
  };
}

interface DefiLlamaChartData {
  data: {
    date: string;
    totalLiquidityUSD: number;
    apy: number;
    apyBase?: number;
    apyReward?: number;
    ilRisk?: string;
  }[];
  status: string;
}

export class DefiLlamaService {
  private client: AxiosInstance;
  private cache: Map<string, { data: unknown; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor() {
    this.client = axios.create({
      baseURL: config.defiLlamaApiUrl,
      timeout: 30000,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'DarkYield/1.0',
      },
    });

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        logger.error('DefiLlama API error', { 
          error: error.message, 
          url: error.config?.url,
          status: error.response?.status,
        });
        throw error;
      }
    );
  }

  private getCacheKey(endpoint: string, params?: Record<string, unknown>): string {
    return `${endpoint}:${JSON.stringify(params || {})}`;
  }

  private async cachedRequest<T>(
    endpoint: string, 
    params?: Record<string, unknown>,
    cacheTtl?: number
  ): Promise<T> {
    const key = this.getCacheKey(endpoint, params);
    const cached = this.cache.get(key);
    const ttl = cacheTtl || this.CACHE_TTL;

    if (cached && Date.now() - cached.timestamp < ttl) {
      return cached.data as T;
    }

    const response = await this.client.get(endpoint, { params });
    this.cache.set(key, { data: response.data, timestamp: Date.now() });
    return response.data;
  }

  async getAllPools(): Promise<Pool[]> {
    try {
      const response = await this.cachedRequest<DefiLlamaPool[] | { data: DefiLlamaPool[]; status: string }>('/pools');
      // Handle both direct array response and wrapped response
      const pools = Array.isArray(response) ? response : (response.data || []);
      if (!Array.isArray(pools)) {
        logger.error('Invalid pools response format', { response: typeof response });
        return [];
      }
      const transformed = pools.map(pool => this.transformPool(pool));
      const filtered = this.filterPoolsByEvmChainPolicy(transformed);
      await enrichPoolsWithDepositPauseFlags(filtered);
      return filtered;
    } catch (error) {
      logger.error('Failed to fetch pools', { error: (error as Error).message });
      return []; // Return empty array instead of throwing to allow fallback to scraper
    }
  }

  /**
   * When `config.poolChainFilterMode` is `evm_only` (default), drop Solana and other non-EVM chains.
   * Set env `POOL_CHAIN_FILTER_MODE=all` to include all DefiLlama chains again.
   */
  private filterPoolsByEvmChainPolicy(pools: Pool[]): Pool[] {
    if (config.poolChainFilterMode === 'all') {
      return pools;
    }
    return pools.filter((p) => isEvmCompatibleLlamaChain(p.chain));
  }

  /** Normalized chain|project|symbol for matching ids that differ from DefiLlama's `pool` field. */
  private poolCompositeKey(p: Pick<Pool, 'chain' | 'project' | 'symbol'>): string {
    return [p.chain, p.project, p.symbol]
      .map((s) => String(s).toLowerCase().trim())
      .join('-');
  }

  async getPool(poolId: string, embeddedHint?: Pool): Promise<Pool | null> {
    try {
      const allPools = await this.getAllPools();

      const exact = allPools.find((p) => p.id === poolId);
      if (exact) return exact;

      const idLower = poolId.toLowerCase();
      const byCase = allPools.find((p) => p.id.toLowerCase() === idLower);
      if (byCase) return byCase;

      const keyFromId = idLower;
      const byComposite = allPools.find((p) => this.poolCompositeKey(p) === keyFromId);
      if (byComposite) return byComposite;

      if (embeddedHint) {
        const k = this.poolCompositeKey(embeddedHint);
        const byHint = allPools.find((p) => this.poolCompositeKey(p) === k);
        if (byHint) return byHint;
      }

      return null;
    } catch (error) {
      logger.error('Failed to fetch pool', error as Error, { poolId });
      return null;
    }
  }

  /**
   * Heuristic 0–100 risk from a pool snapshot (same rules as live DefiLlama transform).
   * Used when the live index id does not match `position.poolId` but we have an embedded pool.
   */
  estimateRiskScoreFromSnapshot(pool: Pool): number {
    const raw: DefiLlamaPool = {
      chain: pool.chain,
      project: pool.project,
      symbol: pool.symbol,
      tvlUsd: pool.tvlUsd,
      apy: pool.apy,
      apyBase: pool.apyBase,
      apyReward: pool.apyReward,
      stablecoin: pool.stablecoin,
      ilRisk: pool.ilRisk,
      exposure: pool.exposure,
      sigma:
        pool.volatilityScore !== undefined && pool.volatilityScore > 0 && pool.volatilityScore <= 100
          ? pool.volatilityScore / 100
          : undefined,
      outlier: pool.apyOutlier === true,
      apyPct7D: pool.apyTrend7d,
      apyPct30D: pool.apyTrend30d,
    };
    return this.calculateRiskScore(raw);
  }

  async getFilteredPools(filter: YieldFilter): Promise<Pool[]> {
    const allPools = await this.getAllPools();
    const memeDiscovery = await coinGeckoService.getMemeDiscoverySymbols();
    const includeInactive = filter.includeInactive === true;
    
    // Pre-compute bluechip status for BLUECHIPS and LONGTAIL modes
    // This avoids calling isBluechipPool multiple times per pool
    let bluechipCache: Map<string, boolean> | null = null;
    
    if (filter.mode === YieldMode.BLUECHIPS || 
        filter.mode === YieldMode.LONGTAIL ||
        filter.mode === YieldMode.STABLE_BLUECHIPS) {
      
      bluechipCache = new Map();
      
      // Get unique pool symbols for batch checking
      const poolSymbols = allPools.map(p => this.extractSymbolsFromPool(p));
      
      // Check CoinGecko top 200
      const top200Symbols = await coinGeckoService.getTop200Symbols();
      
      for (let i = 0; i < allPools.length; i++) {
        const pool = allPools[i];
        const symbols = poolSymbols[i];

        if (this.isLikelyMemecoinPool(pool, memeDiscovery)) {
          bluechipCache.set(pool.id, false);
          continue;
        }
        
        let isBluechip = false;
        
        // Check if on established chain
        const establishedChains = [
          'Ethereum', 'Arbitrum', 'Optimism', 'Base', 'Polygon', 'Avalanche', 
          'BSC', 'Fantom', 'Solana', 'Cronos', 'Metis', 'Mantle', 'Gnosis',
          'Celo', 'Moonbeam', 'Moonriver', 'Kava', 'Aurora', 'Harmony'
        ];
        const isEstablishedChain = establishedChains.includes(pool.chain);
        
        if (isEstablishedChain && pool.tvlUsd >= 5_000_000 && pool.ilRisk !== 'high') {
          // Check against CoinGecko top 200
          if (top200Symbols.size > 0) {
            for (const symbol of symbols) {
              if (top200Symbols.has(symbol.toUpperCase())) {
                isBluechip = true;
                break;
              }
            }
          }
          
          // Fallback to known list if CoinGecko unavailable
          if (!isBluechip) {
            isBluechip = this.isKnownMajorCrypto(symbols);
          }
        }
        
        bluechipCache.set(pool.id, isBluechip);
      }
    }
    
    const filtered = allPools.filter(pool => {
      if (!includeInactive && pool.inactive) {
        return false;
      }

      // Mode-specific filtering
      
      // STABLECOINS: Only stablecoins
      if (filter.mode === YieldMode.STABLECOINS) {
        if (!pool.stablecoin || this.isLikelyMemecoinPool(pool, memeDiscovery)) {
          return false;
        }
      }

      // MEMECOINS: meme / animal-coin pools only (not bluechip or long-tail)
      if (filter.mode === YieldMode.MEMECOINS && !this.isLikelyMemecoinPool(pool, memeDiscovery)) {
        return false;
      }

      // BLUECHIPS: Only bluechip tokens (top 200 market cap equivalent)
      // These are established, high-market-cap tokens like ETH, WBTC, etc.
      if (filter.mode === YieldMode.BLUECHIPS) {
        const isBluechip = bluechipCache?.get(pool.id) || false;
        // Bluechips are major tokens - not stablecoins, not long tail, not memecoins
        if (!isBluechip || pool.stablecoin || this.isLikelyMemecoinPool(pool, memeDiscovery)) {
          return false;
        }
      }

      // LONGTAIL: Everything else that's not bluechip and not stablecoin
      // Higher risk, higher potential reward, emerging protocols
      if (filter.mode === YieldMode.LONGTAIL) {
        const isBluechip = bluechipCache?.get(pool.id) || false;
        // Long tail excludes: stablecoins, bluechips, and memecoins
        if (pool.stablecoin || isBluechip || this.isLikelyMemecoinPool(pool, memeDiscovery)) {
          return false;
        }
      }

      // STABLE_BLUECHIPS hybrid mode - includes stablecoins + bluechips
      if (filter.mode === YieldMode.STABLE_BLUECHIPS) {
        const isBluechip = bluechipCache?.get(pool.id) || false;
        if (this.isLikelyMemecoinPool(pool, memeDiscovery) || (!pool.stablecoin && !isBluechip)) {
          return false;
        }
      }

      // TVL filters
      if (filter.minTvl && pool.tvlUsd < filter.minTvl) {
        return false;
      }
      if (filter.maxTvl && pool.tvlUsd > filter.maxTvl) {
        return false;
      }

      // APY filters
      if (filter.minApy && pool.apy < filter.minApy) {
        return false;
      }
      if (filter.maxApy && pool.apy > filter.maxApy) {
        return false;
      }

      // Chain filter
      if (filter.chains && !filter.chains.includes(pool.chain)) {
        return false;
      }

      // Protocol exclusion
      if (filter.excludeProtocols?.includes(pool.project)) {
        return false;
      }

      // IL Risk filter
      if (filter.excludeILRisk && pool.ilRisk !== 'no') {
        return false;
      }

      // Risk level filter
      if (filter.maxRiskLevel && pool.riskScore) {
        const riskLevels = Object.values(RiskLevel);
        const poolRiskIndex = riskLevels.indexOf(pool.riskScore as unknown as RiskLevel);
        const maxRiskIndex = riskLevels.indexOf(filter.maxRiskLevel);
        if (poolRiskIndex > maxRiskIndex) {
          return false;
        }
      }

      // Sortino ratio filter
      if (filter.minSortinoRatio && (!pool.sortinoRatio || pool.sortinoRatio < filter.minSortinoRatio)) {
        return false;
      }

      // APY prediction requirement
      if (filter.requireApyPrediction && !pool.apyPrediction) {
        return false;
      }

      // Locking period filter
      if (filter.excludeLocking && pool.lockingPeriod && pool.lockingPeriod > 0) {
        return false;
      }

      return true;
    });

    const floored = filtered.map((p) => this.applyMemecoinVolatilityFloor(p, memeDiscovery));
    return this.applyApyOutlierFilter(floored, filter);
  }

  /** Effective APY ceiling (%), clamped between 1 and server hard cap. */
  resolveApySanityCeiling(filter: Pick<YieldFilter, 'maxReasonableApyPercent'>): number {
    const requested = filter.maxReasonableApyPercent ?? config.poolMaxApyPercent;
    return Math.min(Math.max(requested, 1), config.poolMaxApyPercentHardCap);
  }

  /**
   * Tag pools with `apyOutlier` when APY exceeds the ceiling; drop them unless `includeApyOutliers`.
   */
  applyApyOutlierFilter(pools: Pool[], filter: Pick<YieldFilter, 'maxReasonableApyPercent' | 'includeApyOutliers'>): Pool[] {
    const ceiling = this.resolveApySanityCeiling(filter);
    const includeOut = filter.includeApyOutliers === true;
    return pools
      .map((p) => ({ ...p, apyOutlier: p.apy > ceiling }))
      .filter((p) => includeOut || !p.apyOutlier);
  }

  /** Ensure memecoin pools never show unrealistically low spot vol (sigma is APY noise, not price vol). */
  private applyMemecoinVolatilityFloor(pool: Pool, discovery: Set<string>): Pool {
    if (!this.isLikelyMemecoinPool(pool, discovery)) {
      return pool;
    }
    const v = pool.volatilityScore ?? 0;
    if (v >= 32) {
      return pool;
    }
    return { ...pool, volatilityScore: Math.max(v, 42) };
  }

  // Enrich pools with CoinGecko token volatility data
  // This provides more accurate volatility for non-stablecoin pools
  async enrichPoolsWithTokenVolatility(pools: Pool[]): Promise<Pool[]> {
    const enrichedPools: Pool[] = [];
    const discovery = await coinGeckoService.getMemeDiscoverySymbols();
    
    for (const pool of pools) {
      const isMeme = this.isLikelyMemecoinPool(pool, discovery);
      // Sigma from yields is APY volatility — still enrich memecoins with spot price vol from CoinGecko
      const skipEnrich =
        !isMeme &&
        pool.volatilityScore !== undefined &&
        pool.volatilityScore > 15 &&
        pool.volatilityScore <= 50;
      if (skipEnrich) {
        enrichedPools.push(pool);
        continue;
      }
      
      // Skip stablecoins - they use APY-based volatility already calculated
      if (pool.stablecoin) {
        enrichedPools.push(pool);
        continue;
      }
      
      // Try to get volatility from underlying tokens
      let tokenVolatility: number | null = null;
      
      if (pool.underlyingTokens && pool.underlyingTokens.length > 0) {
        tokenVolatility = await coinGeckoService.getPoolVolatility(pool.underlyingTokens);
      } else {
        // Try to extract tokens from pool symbol (e.g., "USDC-ETH" or "USDC/ETH")
        const symbolTokens = this.extractSymbolsFromPool(pool);
        tokenVolatility = await coinGeckoService.getPoolVolatility(symbolTokens);
      }
      
      if (tokenVolatility !== null) {
        const existingVol = pool.volatilityScore || 0;
        const blendedVol = isMeme
          ? Math.max(existingVol, tokenVolatility, 35)
          : existingVol > 0
            ? Math.min(existingVol, tokenVolatility)
            : tokenVolatility;
        
        enrichedPools.push({
          ...pool,
          volatilityScore: Math.min(blendedVol, 100),
        });
        
        logger.debug('Enriched pool with token volatility', {
          pool: pool.id,
          symbol: pool.symbol,
          tokenVol: tokenVolatility.toFixed(2),
          finalVol: blendedVol.toFixed(2),
        });
      } else {
        enrichedPools.push(isMeme ? this.applyMemecoinVolatilityFloor(pool, discovery) : pool);
      }
    }
    
    return enrichedPools;
  }

  async getPoolChartData(poolId: string, days: number = 30): Promise<HistoricalDataPoint[]> {
    try {
      // poolId format is usually "chain-project-symbol-poolMeta"
      const [chain, project, symbol, ...poolMetaParts] = poolId.split('-');
      const poolMeta = poolMetaParts.join('-') || undefined;
      
      const params: Record<string, string | undefined> = {
        pool: poolId,
      };

      const chartData = await this.cachedRequest<DefiLlamaChartData>(
        `/chart/${poolId}`,
        params,
        10 * 60 * 1000 // 10 min cache for historical data
      );

      if (!chartData.data || !Array.isArray(chartData.data)) {
        return [];
      }

      return chartData.data.map(point => ({
        timestamp: new Date(point.date),
        poolId,
        apy: point.apy,
        tvl: point.totalLiquidityUSD,
      }));
    } catch (error) {
      logger.error('Failed to fetch chart data', error as Error, { poolId, days });
      return [];
    }
  }

  async getChains(): Promise<Chain[]> {
    try {
      // Use main DefiLlama API for chains (not yields API)
      const response = await axios.get<Array<{
        geckoId?: string;
        tokenSymbol?: string;
        cmkId?: string;
        name: string;
        chainId?: string;
      }> | { data: Array<{ geckoId?: string; tokenSymbol?: string; name: string; chainId?: string }> }>('https://api.llama.fi/v2/chains', {
        timeout: 30000,
        headers: { 'Accept': 'application/json', 'User-Agent': 'DarkYield/1.0' }
      });

      // Handle both direct array response and wrapped response
      const chains = Array.isArray(response.data) ? response.data : (response.data.data || []);
      if (!Array.isArray(chains)) {
        logger.error('Invalid chains response format', { response: typeof response.data });
        return [];
      }

      return chains.map(chain => ({
        id: chain.chainId || chain.name.toLowerCase().replace(/\s+/g, '-'),
        name: chain.name,
        tokenSymbol: chain.tokenSymbol || '',
        geckoId: chain.geckoId,
      }));
    } catch (error) {
      logger.error('Failed to fetch chains', { error: (error as Error).message });
      return [];
    }
  }

  async getProtocols(): Promise<Protocol[]> {
    try {
      // Use main DefiLlama API for protocols (not yields API)
      const response = await axios.get<Array<{
        id: string;
        name: string;
        url?: string;
        logo?: string;
        tvl?: number;
        chains: string[];
        category?: string;
        chainTvls?: Record<string, number>;
      }> | { data: Array<{ id: string; name: string; url?: string; logo?: string; tvl?: number; chains: string[]; category?: string }> }>('https://api.llama.fi/protocols', {
        timeout: 30000,
        headers: { 'Accept': 'application/json', 'User-Agent': 'DarkYield/1.0' }
      });

      // Handle both direct array response and wrapped response
      const protocols = Array.isArray(response.data) ? response.data : (response.data.data || []);
      if (!Array.isArray(protocols)) {
        logger.error('Invalid protocols response format', { response: typeof response.data });
        return [];
      }

      return protocols.map(protocol => ({
        id: protocol.id,
        name: protocol.name,
        url: protocol.url,
        logo: protocol.logo,
        tvl: protocol.tvl,
        chains: protocol.chains,
        category: protocol.category,
        riskLevel: this.assessProtocolRisk(protocol),
      }));
    } catch (error) {
      logger.error('Failed to fetch protocols', { error: (error as Error).message });
      return [];
    }
  }

  private transformPool(raw: DefiLlamaPool): Pool {
    const poolId = raw.pool || `${raw.chain}-${raw.project}-${raw.symbol}${raw.poolMeta ? '-' + raw.poolMeta : ''}`;
    
    // Calculate volatility score from sigma if available
    // DefiLlama sigma is the standard deviation of APY (as decimal, e.g., 0.05 = 5%)
    // For stablecoins, expected volatility is typically 0-5%
    // For volatile assets, can be 20-50%+
    let volatilityScore: number | undefined;
    if (raw.sigma && raw.sigma > 0 && raw.sigma < 2) {
      // Sigma is already in decimal form (e.g., 0.05 for 5% vol), convert to percentage
      // Only use if sigma is reasonable (< 200% as sanity check)
      volatilityScore = Math.min(raw.sigma * 100, 100);
    }
    
    // For stablecoins with missing/invalid volatility, set a low default based on APY variance
    if (raw.stablecoin && (!volatilityScore || volatilityScore > 50)) {
      // Stablecoins should have low volatility - estimate from APY stability
      const apyVariance = Math.abs(raw.apyPct7D || 0) + Math.abs(raw.apyPct30D || 0);
      volatilityScore = Math.min(Math.max(apyVariance * 2, 2), 15); // 2-15% range for stablecoins
    }
    
    // Calculate risk score based on multiple factors
    const riskScore = this.calculateRiskScore(raw);

    // APY outlook: DefiLlama ML `Predictions` is sparse; fill the rest with a heuristic band
    // from headline APY + 7d/30d ΔAPY and sigma so consumers almost always have `apyPrediction`.
    let apyPrediction: APYPrediction | undefined;
    if (raw.Predictions) {
      const confidence = raw.Predictions.binnedConfidence >= 0.7 ? 'HIGH' : 
                        raw.Predictions.binnedConfidence >= 0.5 ? 'MEDIUM' : 'LOW';
      apyPrediction = {
        currentApy: raw.apy || 0,
        predictedMinApy: raw.Predictions.predictedProbability * (raw.apy || 0),
        confidence,
        timeframe: '4 weeks (DefiLlama ML)',
        expiresAt: new Date(Date.now() + 28 * 24 * 60 * 60 * 1000),
      };
    } else if (!this.isPoolYieldInactive(raw)) {
      apyPrediction = this.inferApyPredictionFromHeuristics(raw);
    }

    const apyTotal = raw.apy ?? 0;
    let apyBase = raw.apyBase ?? 0;
    let apyReward = raw.apyReward ?? 0;
    const componentSum = apyBase + apyReward;
    const negligible = 1e-6;
    // DefiLlama often omits apyBase/apyReward while still sending headline `apy` (points, Merkl, etc.).
    // Attribute the full headline to base so UI base+reward matches the summary APY.
    if (apyTotal > negligible && componentSum <= negligible) {
      apyBase = apyTotal;
      apyReward = 0;
    }

    const poolOut: Pool = {
      id: poolId,
      chain: raw.chain,
      project: raw.project,
      symbol: raw.symbol,
      tvlUsd: raw.tvlUsd,
      apyBase,
      apyReward,
      apy: apyTotal,
      apyBase7d: raw.apyBase7d,
      apyMean30d: raw.apyMean30d,
      stablecoin: raw.stablecoin,
      ilRisk: raw.ilRisk,
      exposure: raw.exposure,
      underlyingTokens: raw.underlyingTokens,
      rewardTokens: raw.rewardTokens,
      poolMeta: raw.poolMeta,
      url: raw.url,
      apyPrediction,
      volatilityScore,
      apyTrend7d: raw.apyPct7D,
      apyTrend30d: raw.apyPct30D,
      riskScore,
      inactive: this.isPoolYieldInactive(raw),
      lastUpdated: new Date(),
    };

    // DefiLlama sigma is APY volatility, not spot price vol — memecoins need a sensible display floor
    if (this.isLikelyMemecoinPool(poolOut) && (poolOut.volatilityScore === undefined || poolOut.volatilityScore < 28)) {
      poolOut.volatilityScore = Math.max(poolOut.volatilityScore ?? 0, 42);
    }

    return poolOut;
  }

  /**
   * When DefiLlama does not ship `Predictions`, derive a conservative min/max APY band from
   * headline APY and optional 7d/30d %ΔAPY (`apyPct7D` / `apyPct30D`) plus sigma.
   */
  private inferApyPredictionFromHeuristics(raw: DefiLlamaPool): APYPrediction | undefined {
    const apy = raw.apy ?? 0;
    if (apy <= 1e-6) return undefined;

    const d7 = raw.apyPct7D;
    const d30 = raw.apyPct30D;
    const hasTrend = d7 != null || d30 != null;

    let worstPct = 0;
    if (d7 !== undefined && d7 < worstPct) worstPct = d7;
    if (d30 !== undefined && d30 < worstPct) worstPct = d30;

    let bestPct = 0;
    if (d7 !== undefined && d7 > bestPct) bestPct = d7;
    if (d30 !== undefined && d30 > bestPct) bestPct = d30;

    const damp = 0.3;
    const predictedMinApy = Math.max(0, apy * (1 + (worstPct / 100) * damp));
    const maxStretch = 2.5;
    const predictedMaxApy = Math.min(
      apy * (1 + maxStretch),
      apy * (1 + Math.min((bestPct / 100) * damp, maxStretch))
    );

    const trendMag = Math.abs(d7 ?? 0) + Math.abs(d30 ?? 0);
    const sigmaDec = raw.sigma ?? 0;
    let confidence: 'LOW' | 'MEDIUM' | 'HIGH' = 'MEDIUM';
    if (!hasTrend) {
      confidence = 'LOW';
    } else if (trendMag > 100 || sigmaDec > 0.45) {
      confidence = 'LOW';
    } else if (trendMag < 18 && sigmaDec < 0.11 && apy < 80) {
      confidence = 'MEDIUM';
    } else {
      confidence = 'LOW';
    }

    const minOut = Number.isFinite(predictedMinApy) ? predictedMinApy : apy * 0.88;
    const maxOut = Number.isFinite(predictedMaxApy) ? predictedMaxApy : apy * 1.12;

    return {
      currentApy: apy,
      predictedMinApy: minOut,
      predictedMaxApy: maxOut,
      confidence,
      timeframe: hasTrend ? 'Heuristic (7d/30d ΔAPY)' : 'Heuristic (no ΔAPY trend)',
      expiresAt: new Date(Date.now() + 28 * 24 * 60 * 60 * 1000),
    };
  }

  /** No meaningful yield reported (still may have TVL from dormant liquidity). */
  private isPoolYieldInactive(raw: DefiLlamaPool): boolean {
    const apy = raw.apy ?? 0;
    const base = raw.apyBase ?? 0;
    const reward = raw.apyReward ?? 0;
    const t = 0.0005;
    return apy <= t && base <= t && reward <= t;
  }

  private calculateRiskScore(pool: DefiLlamaPool): number {
    let score = 50; // Base score

    // TVL factor (higher TVL = lower risk)
    if (pool.tvlUsd > 100_000_000) score -= 15;
    else if (pool.tvlUsd > 10_000_000) score -= 10;
    else if (pool.tvlUsd > 1_000_000) score -= 5;
    else score += 10; // Low TVL penalty

    // IL Risk factor
    if (pool.ilRisk === 'yes') score += 20;
    else if (pool.ilRisk === 'high') score += 15;
    else if (pool.ilRisk === 'medium') score += 10;
    else if (pool.ilRisk === 'no') score -= 10;

    // Stablecoin factor
    if (pool.stablecoin) score -= 5;
    else score += 5;

    // Volatility factor
    if (pool.sigma) {
      if (pool.sigma > 0.5) score += 15;
      else if (pool.sigma > 0.3) score += 10;
      else if (pool.sigma > 0.1) score += 5;
      else score -= 5;
    }

    // Outlier detection (suspicious APY)
    if (pool.outlier) score += 15;

    // Clamp to 0-100
    return Math.max(0, Math.min(100, score));
  }

  private assessProtocolRisk(protocol: { category?: string; tvl?: number }): RiskLevel {
    // Simple risk assessment based on category and TVL
    const tvl = protocol.tvl || 0;
    const category = protocol.category?.toLowerCase() || '';

    // High TVL protocols are generally safer
    if (tvl > 1_000_000_000) {
      if (category.includes('dex') || category.includes('lending')) {
        return RiskLevel.LOW;
      }
      return RiskLevel.MODERATE;
    }

    if (tvl > 100_000_000) {
      if (category.includes('yield') || category.includes('option')) {
        return RiskLevel.HIGH;
      }
      return RiskLevel.MODERATE;
    }

    if (tvl > 10_000_000) {
      return RiskLevel.HIGH;
    }

    return RiskLevel.EXTREME;
  }

  // Get pools suitable for specific modes
  async getStablecoinPools(minTvl: number = 1_000_000): Promise<Pool[]> {
    return this.getFilteredPools({
      mode: YieldMode.STABLECOINS,
      stablecoinsOnly: true,
      minTvl,
      excludeILRisk: true,
    });
  }

  // Clear cache
  clearCache(): void {
    this.cache.clear();
    logger.info('DefiLlama cache cleared');
  }

  // Get Outlook prediction for a pool (via scraping if not in API)
  async getOutlookPrediction(poolId: string): Promise<APYPrediction | null> {
    // First try to get from API
    const pool = await this.getPool(poolId);
    if (pool?.apyPrediction) {
      return pool.apyPrediction;
    }

    // Try scraping the pool page for Outlook
    try {
      logger.info('Fetching Outlook via scraper', { poolId });
      const scraped = await defiLlamaScraper.scrapePoolDetail(poolId);
      return scraped.outlook;
    } catch (error) {
      logger.error('Failed to scrape Outlook', error as Error, { poolId });
      return null;
    }
  }

  // Enrich pools with Outlook predictions
  async enrichPoolsWithOutlook(pools: Pool[]): Promise<Pool[]> {
    const enriched = [...pools];
    const poolsWithoutOutlook = enriched.filter(p => !p.apyPrediction);

    if (poolsWithoutOutlook.length === 0) {
      return enriched;
    }

    logger.info('Enriching pools with Outlook predictions', { 
      total: pools.length, 
      toEnrich: poolsWithoutOutlook.length,
    });

    // Scrape in batches to be respectful
    const batchSize = 5;
    for (let i = 0; i < poolsWithoutOutlook.length; i += batchSize) {
      const batch = poolsWithoutOutlook.slice(i, i + batchSize);
      const poolIds = batch.map(p => p.id);

      const results = await defiLlamaScraper.scrapeMultiplePools(poolIds);

      for (const [poolId, data] of results) {
        const poolIndex = enriched.findIndex(p => p.id === poolId);
        if (poolIndex >= 0 && data.outlook) {
          enriched[poolIndex] = {
            ...enriched[poolIndex],
            apyPrediction: data.outlook,
          };
        }
      }

      // Add delay between batches
      if (i + batchSize < poolsWithoutOutlook.length) {
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

    const enrichedCount = enriched.filter(p => p.apyPrediction).length - 
                          pools.filter(p => p.apyPrediction).length;
    
    logger.info('Outlook enrichment complete', { 
      enriched: enrichedCount,
      totalWithOutlook: enriched.filter(p => p.apyPrediction).length,
    });

    return enriched;
  }

  // Get pools with scraping fallback (useful when API is rate limited or unavailable)
  async getPoolsWithFallback(filter: YieldFilter): Promise<Pool[]> {
    // First try the API
    try {
      const pools = await this.getFilteredPools(filter);
      if (pools.length > 0) {
        return pools;
      }
    } catch (error) {
      logger.warn('API fetch failed, trying scraper', error as Error);
    }

    // Fall back to scraping
    try {
      logger.info('Falling back to scraping for pools', { mode: filter.mode });
      const scraped = await defiLlamaScraper.scrapeYieldsPage(filter.mode);
      return this.filterPoolsByEvmChainPolicy(scraped.pools);
    } catch (error) {
      logger.error('Scraping also failed', error as Error);
      return [];
    }
  }

  // Get pools for hybrid STABLE_BLUECHIPS mode
  async getStableBluechipPools(minTvl: number = 5_000_000): Promise<Pool[]> {
    return this.getFilteredPools({
      mode: YieldMode.STABLE_BLUECHIPS,
      minTvl,
      excludeILRisk: true,
    });
  }

  // Get pools for BLUECHIPS mode (top 200 market cap equivalent)
  async getBluechipPools(minTvl: number = 5_000_000): Promise<Pool[]> {
    return this.getFilteredPools({
      mode: YieldMode.BLUECHIPS,
      minTvl,
    });
  }

  // Get pools for LONGTAIL mode (everything except bluechips and stablecoins)
  async getLongtailPools(minTvl: number = 500_000, maxTvl: number = 50_000_000): Promise<Pool[]> {
    return this.getFilteredPools({
      mode: YieldMode.LONGTAIL,
      minTvl,
      maxTvl,
    });
  }

  // Helper: Check if a pool qualifies as a "bluechip" pool (top 200 market cap equivalent)
  // Uses CoinGecko free API to get top 200 market cap coins
  private async isBluechipPool(pool: Pool): Promise<boolean> {
    // Bluechip criteria:
    // 1. Minimum TVL threshold ($5M+) for established liquidity
    // 2. Token is in CoinGecko top 200 market cap OR matches known major crypto list
    // 3. On established chains
    // 4. Reasonable risk profile (not extreme IL risk)

    const discovery = await coinGeckoService.getMemeDiscoverySymbols();
    if (this.isLikelyMemecoinPool(pool, discovery)) {
      return false;
    }

    if (pool.tvlUsd < 5_000_000) {
      return false;
    }

    // Exclude high IL risk pools from bluechip classification
    if (pool.ilRisk === 'high') {
      return false;
    }

    // Established chains for bluechips
    const establishedChains = [
      'Ethereum', 'Arbitrum', 'Optimism', 'Base', 'Polygon', 'Avalanche', 
      'BSC', 'Fantom', 'Solana', 'Cronos', 'Metis', 'Mantle', 'Gnosis',
      'Celo', 'Moonbeam', 'Moonriver', 'Kava', 'Aurora', 'Harmony'
    ];
    const isEstablishedChain = establishedChains.includes(pool.chain);
    if (!isEstablishedChain) {
      return false;
    }

    // Extract token symbols from pool
    const poolSymbols = this.extractSymbolsFromPool(pool);
    
    // Check against CoinGecko top 200
    const top200Symbols = await coinGeckoService.getTop200Symbols();
    
    // If we have CoinGecko data, use it
    if (top200Symbols.size > 0) {
      for (const symbol of poolSymbols) {
        if (top200Symbols.has(symbol.toUpperCase())) {
          return true;
        }
      }
    }
    
    // Fallback: Check against hardcoded list of major cryptos
    // This is used when CoinGecko API is unavailable
    return this.isKnownMajorCrypto(poolSymbols);
  }

  /** Heuristic: pool involves a known memecoin ticker (any leg or reward). */
  private isLikelyMemecoinPool(pool: Pool, coinGeckoDiscovery?: Set<string>): boolean {
    const symbols = this.extractSymbolsFromPool(pool);
    for (const raw of symbols) {
      if (!raw || raw.length < 2) continue;
      let s = raw.toUpperCase().trim();
      s = s.replace(/^[\d.]+/, '');
      if (MEMECOIN_SYMBOLS.has(s)) {
        return true;
      }
      if (coinGeckoDiscovery?.has(s)) {
        return true;
      }
      if (s.startsWith('W') && s.length > 3) {
        const unwrapped = s.slice(1);
        if (MEMECOIN_SYMBOLS.has(unwrapped)) {
          return true;
        }
        if (coinGeckoDiscovery?.has(unwrapped)) {
          return true;
        }
      }
    }
    return false;
  }

  // Extract token symbols from pool data
  private extractSymbolsFromPool(pool: Pool): string[] {
    const symbols: string[] = [];
    
    // Add main symbol
    symbols.push(pool.symbol);
    
    // Split compound symbols (e.g., "WETH-USDC" -> ["WETH", "USDC"])
    const parts = pool.symbol.split(/[-\/]/);
    symbols.push(...parts);
    
    // Add underlying token symbols if available
    if (pool.underlyingTokens) {
      for (const token of pool.underlyingTokens) {
        // Extract symbol from token address or use directly if it's a symbol
        const tokenParts = token.split('-');
        symbols.push(tokenParts[tokenParts.length - 1]);
      }
    }

    if (pool.rewardTokens) {
      for (const token of pool.rewardTokens) {
        const tokenParts = token.split('-');
        symbols.push(tokenParts[tokenParts.length - 1]);
      }
    }
    
    return [...new Set(symbols)]; // Remove duplicates
  }

  // Fallback check for major cryptos when CoinGecko API is unavailable
  private isKnownMajorCrypto(symbols: string[]): boolean {
    // Core major cryptocurrencies (top tier, always considered bluechip)
    const coreBluechips = [
      'ETH', 'WETH', 'BTC', 'WBTC', 'SOL', 'WBNB', 'BNB',
      'AVAX', 'WAVAX', 'MATIC', 'WMATIC', 'POL', 'ARB', 'OP',
      // LSTs
      'stETH', 'wstETH', 'cbETH', 'rETH', 'sfrxETH',
      // Major DeFi
      'UNI', 'AAVE', 'CRV', 'LDO', 'MKR', 'SNX', 'COMP',
      'LINK', 'GRT', 'PENDLE', 'GMX', 'DYDX',
    ];

    for (const symbol of symbols) {
      const upperSymbol = symbol.toUpperCase();
      if (coreBluechips.includes(upperSymbol)) {
        return true;
      }
      // Check wrapped variants
      if (upperSymbol.startsWith('W') && coreBluechips.includes(upperSymbol.substring(1))) {
        return true;
      }
    }
    
    return false;
  }
}

export const defiLlamaService = new DefiLlamaService();
