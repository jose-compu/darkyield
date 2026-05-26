import { Router, Request, Response } from 'express';
import { schedulerService } from '../services/scheduler.js';
import { telegramService } from '../services/telegram.js';
import { defiLlamaService } from '../services/defillama.js';
import { portfolioService } from '../services/portfolio.js';
import { coinGeckoService } from '../services/coingecko.js';
import { config, NODE_ENV } from '../config/index.js';
import { logger } from '../utils/logger.js';

const router = Router();

// GET /api/system/status - Get system status
router.get('/status', (_req: Request, res: Response) => {
  const schedulerStatus = schedulerService.getStatus();
  const telegramStatus = telegramService.getStatus();

  res.json({
    success: true,
    status: {
      environment: NODE_ENV,
      paperTrading: config.paperTrading,
      scheduler: schedulerStatus,
      telegram: telegramStatus,
      pools: {
        maxReasonableApyPercentDefault: config.poolMaxApyPercent,
        maxReasonableApyPercentHardCap: config.poolMaxApyPercentHardCap,
      },
      timestamp: new Date().toISOString(),
    },
  });
});

// GET /api/system/stats - Get system statistics
router.get('/stats', (_req: Request, res: Response) => {
  const portfolios = portfolioService.getAllPortfolios();
  
  let totalValue = 0;
  let totalReturn = 0;
  const activePositions: number[] = [];

  for (const portfolio of portfolios) {
    totalValue += portfolio.totalValue;
    totalReturn += portfolio.performanceMetrics.totalReturn;
    activePositions.push(portfolio.positions.filter(p => p.status === 'ACTIVE').length);
  }

  res.json({
    success: true,
    stats: {
      portfolios: {
        count: portfolios.length,
        totalValue,
        averageReturn: portfolios.length > 0 ? totalReturn / portfolios.length : 0,
      },
      positions: {
        total: activePositions.reduce((a, b) => a + b, 0),
        averagePerPortfolio: portfolios.length > 0 ? activePositions.reduce((a, b) => a + b, 0) / portfolios.length : 0,
      },
      timestamp: new Date().toISOString(),
    },
  });
});

// POST /api/system/scheduler/start - Start scheduler
router.post('/scheduler/start', (_req: Request, res: Response) => {
  try {
    schedulerService.start();
    res.json({
      success: true,
      message: 'Scheduler started',
      status: schedulerService.getStatus(),
    });
  } catch (error) {
    logger.error('Failed to start scheduler', error as Error);
    res.status(500).json({
      success: false,
      error: 'Failed to start scheduler',
    });
  }
});

// POST /api/system/scheduler/stop - Stop scheduler
router.post('/scheduler/stop', (_req: Request, res: Response) => {
  try {
    schedulerService.stop();
    res.json({
      success: true,
      message: 'Scheduler stopped',
      status: schedulerService.getStatus(),
    });
  } catch (error) {
    logger.error('Failed to stop scheduler', error as Error);
    res.status(500).json({
      success: false,
      error: 'Failed to stop scheduler',
    });
  }
});

// POST /api/system/cache/clear - Clear all caches
router.post('/cache/clear', (_req: Request, res: Response) => {
  defiLlamaService.clearCache();
  
  res.json({
    success: true,
    message: 'Caches cleared',
  });
});

// POST /api/system/telegram/test - Test Telegram connection
router.post('/telegram/test', async (_req: Request, res: Response) => {
  const connected = await telegramService.testConnection();
  
  if (connected) {
    await telegramService.notifyStartup();
  }
  
  res.json({
    success: true,
    connected,
    status: telegramService.getStatus(),
  });
});

// POST /api/system/telegram/notify - Send test notification
router.post('/telegram/notify', async (req: Request, res: Response) => {
  const message = req.body.message || 'Test notification from DarkYield';
  
  await telegramService.sendMessage(`🧪 ${message}`);
  
  res.json({
    success: true,
    message: 'Notification sent',
  });
});

// GET /api/system/config - Get system configuration (sanitized)
router.get('/config', (_req: Request, res: Response) => {
  res.json({
    success: true,
    config: {
      paperTrading: config.paperTrading,
      defaultRebalanceFrequency: config.defaultRebalanceFrequency,
      minRebalanceInterval: config.minRebalanceInterval,
      riskCheckInterval: config.riskCheckInterval,
      maxConcurrentPositions: config.maxConcurrentPositions,
      telegramEnabled: !!config.telegram,
      rpcEndpoints: Object.keys(config.rpcEndpoints),
      walletConfigured: !!config.walletConfig,
    },
  });
});

// GET /api/system/coingecko/status - Check CoinGecko API health
router.get('/coingecko/status', async (_req: Request, res: Response) => {
  const healthStatus = coinGeckoService.getHealthStatus();
  const usageStats = coinGeckoService.getUsageStats();
  const healthCheck = await coinGeckoService.healthCheck();
  
  res.json({
    success: true,
    coingecko: {
      healthy: healthCheck.healthy,
      message: healthCheck.message,
      stats: usageStats,
      health: {
        isHealthy: healthStatus.isHealthy,
        lastSuccess: healthStatus.lastSuccess,
        lastError: healthStatus.lastError,
        consecutiveFailures: healthStatus.consecutiveFailures,
        totalRequests: healthStatus.totalRequests,
        rateLimitHits: healthStatus.rateLimitHits,
      },
    },
  });
});

// POST /api/system/coingecko/clear - Clear CoinGecko cache (force refresh)
router.post('/coingecko/clear', (_req: Request, res: Response) => {
  coinGeckoService.clearCache();
  
  res.json({
    success: true,
    message: 'CoinGecko cache cleared - next request will fetch fresh data',
  });
});

export default router;
