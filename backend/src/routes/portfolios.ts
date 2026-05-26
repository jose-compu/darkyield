import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { portfolioService } from '../services/portfolio.js';
import { optimizationService } from '../services/optimizer.js';
import { riskService, RiskService } from '../services/risk.js';
import { schedulerService } from '../services/scheduler.js';
import { defiLlamaService } from '../services/defillama.js';
import { 
  YieldMode, 
  RebalanceFrequency,
  PortfolioSettings,
  OptimizationInput,
  type Portfolio,
} from '../../../shared/types/index.js';
import { logger } from '../utils/logger.js';

const router = Router();

// Schema for creating portfolio
const createPortfolioSchema = z.object({
  name: z.string().optional(),
  mode: z.nativeEnum(YieldMode).default(YieldMode.STABLECOINS),
  initialCapital: z.number().positive().default(10000),
  rebalanceFrequency: z.nativeEnum(RebalanceFrequency).default(RebalanceFrequency.DAILY),
  minRebalanceThreshold: z.number().min(1).max(50).default(5),
  maxSlippage: z.number().min(0.1).max(10).default(1),
  maxGasCostPerTrade: z.number().min(1).default(50),
  minPoolTvl: z.number().min(1000).default(1_000_000),
  apyThreshold: z.number().min(0).default(1),
  maxPoolConcentration: z.number().min(5).max(100).default(25),
  paperTrading: z.boolean().default(true),
  telegramNotifications: z.boolean().default(false),
});

async function enrichPortfolioWithRiskSummary(portfolio: Portfolio) {
  const assessment = await riskService.assessPortfolio(portfolio);
  return {
    ...portfolio,
    riskSummary: {
      score: assessment.score,
      level: assessment.level,
      breakdown: assessment.breakdown,
      positionRiskRows: RiskService.toPositionRiskRows(portfolio, assessment.positionRisks),
    },
  };
}

// GET /api/portfolios - Get all portfolios (includes structural riskSummary per portfolio)
router.get('/', async (_req: Request, res: Response) => {
  try {
    const portfolios = portfolioService.getAllPortfolios();
    const enriched = await Promise.all(
      portfolios.map((p) => enrichPortfolioWithRiskSummary(p))
    );

    res.json({
      success: true,
      count: enriched.length,
      portfolios: enriched,
    });
  } catch (error) {
    logger.error('Error listing portfolios', error as Error);
    res.status(500).json({
      success: false,
      error: 'Failed to list portfolios',
    });
  }
});

// POST /api/portfolios - Create new portfolio
router.post('/', async (req: Request, res: Response) => {
  try {
    const data = createPortfolioSchema.parse(req.body);
    
    const settings: PortfolioSettings = {
      initialCapital: data.initialCapital,
      mode: data.mode,
      rebalanceFrequency: data.rebalanceFrequency,
      minRebalanceThreshold: data.minRebalanceThreshold,
      maxSlippage: data.maxSlippage,
      maxGasCostPerTrade: data.maxGasCostPerTrade,
      riskTriggers: [
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
      ],
      telegramNotifications: data.telegramNotifications,
      paperTrading: data.paperTrading,
      maxPoolConcentration: data.maxPoolConcentration,
      minPoolTvl: data.minPoolTvl,
      apyThreshold: data.apyThreshold,
    };

    const portfolio = await portfolioService.createPortfolio(
      data.name || `Portfolio ${Date.now()}`,
      settings
    );

    // Schedule rebalancing for this portfolio
    schedulerService.schedulePortfolioRebalance(portfolio);

    res.status(201).json({
      success: true,
      portfolio,
    });
  } catch (error) {
    logger.error('Error creating portfolio', error as Error);
    res.status(400).json({
      success: false,
      error: 'Failed to create portfolio',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// GET /api/portfolios/:id - Get portfolio details (includes structural riskSummary)
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const portfolio = portfolioService.getPortfolio(req.params.id);

    if (!portfolio) {
      return res.status(404).json({
        success: false,
        error: 'Portfolio not found',
      });
    }

    const stats = portfolioService.getPortfolioStats(req.params.id);
    const history = portfolioService.getPerformanceHistory(req.params.id, 30);
    const enriched = await enrichPortfolioWithRiskSummary(portfolio);

    res.json({
      success: true,
      portfolio: enriched,
      stats,
      history: history.slice(-30), // Last 30 snapshots
    });
  } catch (error) {
    logger.error('Error getting portfolio', error as Error);
    res.status(500).json({
      success: false,
      error: 'Failed to get portfolio',
    });
  }
});

// GET /api/portfolios/:id/history - Get portfolio history
router.get('/:id/history', (req: Request, res: Response) => {
  const portfolio = portfolioService.getPortfolio(req.params.id);
  
  if (!portfolio) {
    return res.status(404).json({
      success: false,
      error: 'Portfolio not found',
    });
  }

  const days = parseInt(req.query.days as string) || 30;
  const history = portfolioService.getPerformanceHistory(req.params.id, days);
  const trades = portfolioService.getTrades(req.params.id);

  res.json({
    success: true,
    portfolioId: req.params.id,
    days,
    snapshots: history,
    trades,
  });
});

// POST /api/portfolios/:id/positions - Enter position
router.post('/:id/positions', async (req: Request, res: Response) => {
  try {
    const portfolio = portfolioService.getPortfolio(req.params.id);
    if (!portfolio) {
      return res.status(404).json({
        success: false,
        error: 'Portfolio not found',
      });
    }

    const { poolId, amount, fees } = req.body;
    
    if (!poolId || !amount) {
      return res.status(400).json({
        success: false,
        error: 'poolId and amount are required',
      });
    }

    const pool = await defiLlamaService.getPool(poolId);
    if (!pool) {
      return res.status(404).json({
        success: false,
        error: 'Pool not found',
      });
    }

    const position = await portfolioService.enterPosition(
      req.params.id,
      pool,
      parseFloat(amount),
      parseFloat(fees) || 0
    );

    res.json({
      success: true,
      position,
    });
  } catch (error) {
    logger.error('Error entering position', error as Error);
    res.status(400).json({
      success: false,
      error: 'Failed to enter position',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// DELETE /api/portfolios/:id/positions/:positionId - Exit position
router.delete('/:id/positions/:positionId', async (req: Request, res: Response) => {
  try {
    const portfolio = portfolioService.getPortfolio(req.params.id);
    if (!portfolio) {
      return res.status(404).json({
        success: false,
        error: 'Portfolio not found',
      });
    }

    const position = await portfolioService.exitPosition(
      req.params.id,
      req.params.positionId,
      req.body.reason || 'Manual exit'
    );

    res.json({
      success: true,
      position,
    });
  } catch (error) {
    logger.error('Error exiting position', error as Error);
    res.status(400).json({
      success: false,
      error: 'Failed to exit position',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// POST /api/portfolios/:id/rebalance - Trigger manual rebalance
router.post('/:id/rebalance', async (req: Request, res: Response) => {
  try {
    const portfolio = portfolioService.getPortfolio(req.params.id);
    if (!portfolio) {
      return res.status(404).json({
        success: false,
        error: 'Portfolio not found',
      });
    }

    const plan = await schedulerService.rebalancePortfolio(req.params.id);
    
    if (!plan) {
      return res.json({
        success: true,
        message: 'Rebalance not needed at this time',
        plan: null,
      });
    }

    res.json({
      success: true,
      plan,
    });
  } catch (error) {
    logger.error('Error rebalancing portfolio', error as Error);
    res.status(500).json({
      success: false,
      error: 'Failed to rebalance portfolio',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// GET /api/portfolios/:id/risk - Get risk assessment
router.get('/:id/risk', async (req: Request, res: Response) => {
  try {
    const portfolio = portfolioService.getPortfolio(req.params.id);
    if (!portfolio) {
      return res.status(404).json({
        success: false,
        error: 'Portfolio not found',
      });
    }

    const riskAssessment = await riskService.assessPortfolio(portfolio);

    res.json({
      success: true,
      risk: riskAssessment,
    });
  } catch (error) {
    logger.error('Error assessing risk', error as Error);
    res.status(500).json({
      success: false,
      error: 'Failed to assess risk',
    });
  }
});

// POST /api/portfolios/:id/optimize - Get optimization suggestion
router.post('/:id/optimize', async (req: Request, res: Response) => {
  try {
    const portfolio = portfolioService.getPortfolio(req.params.id);
    if (!portfolio) {
      return res.status(404).json({
        success: false,
        error: 'Portfolio not found',
      });
    }

    // Get pools for the portfolio mode
    let pools: Array<{ id: string; chain: string; project: string; symbol: string; tvlUsd: number; apy: number; apyBase: number; apyReward: number; stablecoin: boolean; ilRisk: 'yes' | 'no' | 'medium' | 'high'; exposure: 'single' | 'multi'; apyPrediction?: { currentApy: number; predictedMinApy: number; confidence: 'LOW' | 'MEDIUM' | 'HIGH'; timeframe: string; expiresAt: Date } | undefined; volatilityScore?: number; lockingPeriod?: number; lastUpdated: Date; riskScore?: number }> = [];
    switch (portfolio.mode) {
      case YieldMode.STABLECOINS:
        pools = await defiLlamaService.getStablecoinPools(portfolio.settings.minPoolTvl);
        break;
      case YieldMode.STABLE_BLUECHIPS:
        pools = await defiLlamaService.getStableBluechipPools(portfolio.settings.minPoolTvl);
        break;
      case YieldMode.BLUECHIPS:
        pools = await defiLlamaService.getBluechipPools(portfolio.settings.minPoolTvl * 10);
        break;
      case YieldMode.LONGTAIL:
        pools = await defiLlamaService.getLongtailPools(portfolio.settings.minPoolTvl / 2);
        break;
      case YieldMode.MEMECOINS:
        pools = await defiLlamaService.getFilteredPools({
          mode: YieldMode.MEMECOINS,
          minTvl: portfolio.settings.minPoolTvl / 2,
        });
        break;
      default:
        pools = await defiLlamaService.getAllPools();
    }

    // Get risk assessment
    const riskAssessment = await riskService.assessPortfolio(portfolio);

    const optimizationInput: OptimizationInput = {
      pools: pools.filter(p => 
        p.tvlUsd >= portfolio.settings.minPoolTvl &&
        p.apy >= portfolio.settings.apyThreshold
      ),
      availableCapital: portfolio.availableCash,
      constraints: {
        maxPools: 10,
        minPoolTvl: portfolio.settings.minPoolTvl,
        maxConcentration: portfolio.settings.maxPoolConcentration / 100,
        totalRiskBudget: riskAssessment.score < 60 ? 70 : 50,
        maxLockingPeriod: 7,
        minApy: portfolio.settings.apyThreshold,
        excludedPools: portfolio.positions.map(p => p.poolId),
        maxGasPerRebalance: portfolio.settings.maxGasCostPerTrade,
      },
      objectives: {
        maximize: req.body.objective || 'RISK_ADJUSTED_RETURN',
        riskAversion: req.body.riskAversion || 0.5,
        timeHorizon: req.body.timeHorizon || 7,
        rebalanceFrequency: portfolio.settings.rebalanceFrequency,
      },
    };

    const optimization = await optimizationService.optimize(optimizationInput);

    // Calculate rebalance cost from current to optimized
    const rebalanceCost = optimizationService.calculateRebalanceCost(
      portfolio.actualAllocation,
      optimization.allocations,
      optimizationInput.constraints
    );

    res.json({
      success: true,
      optimization,
      rebalanceCost,
      currentMetrics: portfolio.performanceMetrics,
    });
  } catch (error) {
    logger.error('Error optimizing portfolio', error as Error);
    res.status(500).json({
      success: false,
      error: 'Failed to optimize portfolio',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// DELETE /api/portfolios/:id - Delete portfolio
router.delete('/:id', (req: Request, res: Response) => {
  const portfolio = portfolioService.getPortfolio(req.params.id);
  
  if (!portfolio) {
    return res.status(404).json({
      success: false,
      error: 'Portfolio not found',
    });
  }

  // TODO: Implement portfolio deletion
  // This should also close all positions and clean up scheduled jobs

  res.json({
    success: true,
    message: 'Portfolio deleted',
  });
});

export default router;
