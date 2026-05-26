import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { defiLlamaService } from '../services/defillama.js';
import { YieldMode, YieldFilter } from '../../../shared/types/index.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';

const router = Router();

/** Express query values are strings; `Boolean('false')` is true — parse explicitly. */
function queryBool(): z.ZodType<boolean | undefined> {
  return z.preprocess((v) => {
    if (v === undefined || v === '' || v === null) return undefined;
    if (v === true || v === 'true' || v === 1 || v === '1') return true;
    if (v === false || v === 'false' || v === 0 || v === '0') return false;
    return undefined;
  }, z.boolean().optional()) as z.ZodType<boolean | undefined>;
}

// Query schema for pool filtering
const filterSchema = z.object({
  mode: z.nativeEnum(YieldMode).optional(),
  minTvl: z.coerce.number().optional(),
  maxTvl: z.coerce.number().optional(),
  minApy: z.coerce.number().optional(),
  maxApy: z.coerce.number().optional(),
  chains: z.string().optional(), // comma-separated
  stablecoinsOnly: queryBool(),
  excludeILRisk: queryBool(),
  requirePrediction: queryBool(),
  excludeLocking: queryBool(),
  /** When true, include pools with ~0% APY (dormant incentives) */
  includeInactive: queryBool(),
  /** Max APY (%) treated as sane; pools above are outliers unless includeApyOutliers */
  maxReasonableApyPercent: z.coerce.number().optional(),
  /** Include pools with absurd reported APY (above maxReasonableApyPercent) */
  includeApyOutliers: queryBool(),
  limit: z.coerce.number().default(50),
});

// GET /api/pools - Get all pools with optional filtering
router.get('/', async (req: Request, res: Response) => {
  try {
    const filters = filterSchema.parse(req.query);
    
    let pools;
    if (filters.mode) {
      const yieldFilter: YieldFilter = {
        mode: filters.mode,
        minTvl: filters.minTvl,
        maxTvl: filters.maxTvl,
        minApy: filters.minApy,
        maxApy: filters.maxApy,
        chains: filters.chains?.split(',').map(c => c.trim()),
        stablecoinsOnly: filters.stablecoinsOnly,
        excludeILRisk: filters.excludeILRisk,
        requireApyPrediction: filters.requirePrediction,
        excludeLocking: filters.excludeLocking,
        includeInactive: filters.includeInactive,
        maxReasonableApyPercent: filters.maxReasonableApyPercent,
        includeApyOutliers: filters.includeApyOutliers,
      };
      pools = await defiLlamaService.getFilteredPools(yieldFilter);
    } else {
      pools = await defiLlamaService.getAllPools();
      if (filters.includeInactive !== true) {
        pools = pools.filter(p => !p.inactive);
      }
      pools = defiLlamaService.applyApyOutlierFilter(pools, {
        maxReasonableApyPercent: filters.maxReasonableApyPercent,
        includeApyOutliers: filters.includeApyOutliers,
      });
      
      // Apply manual filters
      if (filters.minTvl) {
        pools = pools.filter(p => p.tvlUsd >= filters.minTvl!);
      }
      if (filters.maxTvl) {
        pools = pools.filter(p => p.tvlUsd <= filters.maxTvl!);
      }
      if (filters.minApy) {
        pools = pools.filter(p => p.apy >= filters.minApy!);
      }
      if (filters.maxApy) {
        pools = pools.filter(p => p.apy <= filters.maxApy!);
      }
      if (filters.stablecoinsOnly) {
        pools = pools.filter(p => p.stablecoin);
      }
    }

    // Sort by APY descending
    pools.sort((a, b) => b.apy - a.apy);

    // Apply limit
    const limited = pools.slice(0, filters.limit);

    res.json({
      success: true,
      count: limited.length,
      total: pools.length,
      pools: limited,
    });
  } catch (error) {
    logger.error('Error fetching pools', error as Error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch pools',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// GET /api/pools/stablecoins - Get stablecoin pools
router.get('/stablecoins', async (req: Request, res: Response) => {
  try {
    const minTvl = parseInt(req.query.minTvl as string) || 1_000_000;
    const pools = await defiLlamaService.getStablecoinPools(minTvl);
    
    res.json({
      success: true,
      count: pools.length,
      pools,
    });
  } catch (error) {
    logger.error('Error fetching stablecoin pools', error as Error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch stablecoin pools',
    });
  }
});

// GET /api/pools/bluechips - Get bluechip pools
router.get('/bluechips', async (req: Request, res: Response) => {
  try {
    const minTvl = parseInt(req.query.minTvl as string) || 10_000_000;
    const pools = await defiLlamaService.getBluechipPools(minTvl);
    
    res.json({
      success: true,
      count: pools.length,
      pools,
    });
  } catch (error) {
    logger.error('Error fetching bluechip pools', error as Error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch bluechip pools',
    });
  }
});

// GET /api/pools/chains - Get all chains
router.get('/chains', async (_req: Request, res: Response) => {
  try {
    const chains = await defiLlamaService.getChains();
    
    res.json({
      success: true,
      count: chains.length,
      chains,
    });
  } catch (error) {
    logger.error('Error fetching chains', error as Error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch chains',
    });
  }
});

// GET /api/pools/protocols - Get all protocols
router.get('/protocols', async (_req: Request, res: Response) => {
  try {
    const protocols = await defiLlamaService.getProtocols();
    
    res.json({
      success: true,
      count: protocols.length,
      protocols,
    });
  } catch (error) {
    logger.error('Error fetching protocols', error as Error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch protocols',
    });
  }
});

// GET /api/pools/:id - Get single pool details
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const poolId = req.params.id;
    const poolRaw = await defiLlamaService.getPool(poolId);
    
    if (!poolRaw) {
      return res.status(404).json({
        success: false,
        error: 'Pool not found',
      });
    }

    const ceiling = Math.min(
      Math.max(
        parseFloat(req.query.maxReasonableApyPercent as string) || config.poolMaxApyPercent,
        1
      ),
      config.poolMaxApyPercentHardCap
    );
    const pool = { ...poolRaw, apyOutlier: poolRaw.apy > ceiling };

    // Get historical data
    const days = parseInt(req.query.days as string) || 30;
    const chartData = await defiLlamaService.getPoolChartData(poolId, days);

    res.json({
      success: true,
      pool,
      chartData,
    });
  } catch (error) {
    logger.error('Error fetching pool details', error as Error, { poolId: req.params.id });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch pool details',
    });
  }
});

// GET /api/pools/:id/chart - Get pool chart data
router.get('/:id/chart', async (req: Request, res: Response) => {
  try {
    const poolId = req.params.id;
    const days = parseInt(req.query.days as string) || 30;
    
    const chartData = await defiLlamaService.getPoolChartData(poolId, days);
    
    res.json({
      success: true,
      poolId,
      days,
      data: chartData,
    });
  } catch (error) {
    logger.error('Error fetching chart data', error as Error, { poolId: req.params.id });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch chart data',
    });
  }
});

export default router;
