import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { defiLlamaScraper } from '../services/scraper.js';
import { logger } from '../utils/logger.js';
import { YieldMode } from '../../../shared/types/index.js';

const router = Router();

// Schema for scraping request
const scrapePoolsSchema = z.object({
  mode: z.enum(['STABLECOINS', 'BLUECHIPS', 'LONGTAIL', 'MEMECOINS']).default('STABLECOINS'),
  maxPools: z.coerce.number().min(1).max(50).default(20),
});

// Helper to convert string to YieldMode
const toYieldMode = (mode: string): YieldMode => {
  switch (mode) {
    case 'BLUECHIPS': return YieldMode.BLUECHIPS;
    case 'LONGTAIL': return YieldMode.LONGTAIL;
    case 'MEMECOINS': return YieldMode.MEMECOINS;
    default: return YieldMode.STABLECOINS;
  }
};

const scrapePoolDetailSchema = z.object({
  poolId: z.string(),
  includeChart: z.coerce.boolean().default(false),
});

// POST /api/scraper/pools - Scrape yields page
router.post('/pools', async (req: Request, res: Response) => {
  try {
    const { mode, maxPools } = scrapePoolsSchema.parse(req.body);

    logger.info('Scraping pools request', { mode, maxPools });

    const result = await defiLlamaScraper.scrapeYieldsPage(toYieldMode(mode));

    // Limit pools if requested
    if (result.pools.length > maxPools) {
      result.pools = result.pools.slice(0, maxPools);
    }

    res.json({
      success: true,
      mode,
      poolsScraped: result.pools.length,
      pools: result.pools,
      apiResponses: result.apiResponses.length,
      timestamp: result.timestamp,
    });
  } catch (error) {
    logger.error('Scraping pools failed', error as Error);
    res.status(500).json({
      success: false,
      error: 'Scraping failed',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// POST /api/scraper/pool/:id - Scrape individual pool detail
router.post('/pool/:id', async (req: Request, res: Response) => {
  try {
    const { includeChart } = scrapePoolDetailSchema.parse({ 
      poolId: req.params.id,
      includeChart: req.query.includeChart,
    });

    const poolId = req.params.id;
    logger.info('Scraping pool detail', { poolId, includeChart });

    const result = await defiLlamaScraper.scrapePoolDetail(poolId);

    if (!result.pool) {
      return res.status(404).json({
        success: false,
        error: 'Pool not found or scraping failed',
      });
    }

    res.json({
      success: true,
      pool: result.pool,
      outlook: result.outlook,
      chartData: includeChart ? result.chartData : undefined,
      apiResponses: result.apiResponses.length,
    });
  } catch (error) {
    logger.error('Scraping pool detail failed', error as Error, { poolId: req.params.id });
    res.status(500).json({
      success: false,
      error: 'Scraping failed',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// POST /api/scraper/batch - Scrape multiple pools
router.post('/batch', async (req: Request, res: Response) => {
  try {
    const { poolIds } = req.body;

    if (!Array.isArray(poolIds) || poolIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'poolIds array is required',
      });
    }

    if (poolIds.length > 20) {
      return res.status(400).json({
        success: false,
        error: 'Maximum 20 pools per batch request',
      });
    }

    logger.info('Batch scraping pools', { count: poolIds.length });

    const results = await defiLlamaScraper.scrapeMultiplePools(poolIds);

    const pools = [];
    const outlooks = [];
    let successCount = 0;

    for (const [poolId, data] of results) {
      if (data.pool) {
        pools.push(data.pool);
        successCount++;
        if (data.outlook) {
          outlooks.push({ poolId, outlook: data.outlook });
        }
      }
    }

    res.json({
      success: true,
      total: poolIds.length,
      successful: successCount,
      failed: poolIds.length - successCount,
      pools,
      outlooks,
    });
  } catch (error) {
    logger.error('Batch scraping failed', error as Error);
    res.status(500).json({
      success: false,
      error: 'Batch scraping failed',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// GET /api/scraper/csv/:id - Download CSV chart data
router.get('/csv/:id', async (req: Request, res: Response) => {
  try {
    const poolId = req.params.id;
    logger.info('CSV download request', { poolId });

    const result = await defiLlamaScraper.downloadChartCSV(poolId);

    if (!result) {
      return res.status(404).json({
        success: false,
        error: 'CSV download not available for this pool',
      });
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.send(result.data);
  } catch (error) {
    logger.error('CSV download failed', error as Error, { poolId: req.params.id });
    res.status(500).json({
      success: false,
      error: 'CSV download failed',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// GET /api/scraper/captured - Get captured API requests
router.get('/captured', (_req: Request, res: Response) => {
  const requests = defiLlamaScraper.getCapturedRequests();
  
  res.json({
    success: true,
    count: requests.length,
    requests: requests.map(r => ({
      url: r.url,
      method: r.method,
      timestamp: r.timestamp,
      hasResponse: !!r.responseBody,
    })),
  });
});

// DELETE /api/scraper/captured - Clear captured requests
router.delete('/captured', (_req: Request, res: Response) => {
  defiLlamaScraper.clearCapturedRequests();
  
  res.json({
    success: true,
    message: 'Captured requests cleared',
  });
});

// GET /api/scraper/health - Health check
router.get('/health', async (_req: Request, res: Response) => {
  try {
    const isHealthy = await defiLlamaScraper.healthCheck();
    
    res.json({
      success: true,
      healthy: isHealthy,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      healthy: false,
      error: error instanceof Error ? error.message : 'Health check failed',
    });
  }
});

// POST /api/scraper/shutdown - Close browser (cleanup)
router.post('/shutdown', async (_req: Request, res: Response) => {
  try {
    await defiLlamaScraper.close();
    
    res.json({
      success: true,
      message: 'Scraper shutdown complete',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Shutdown failed',
    });
  }
});

export default router;
