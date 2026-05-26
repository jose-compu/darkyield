import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';

import { PORT, config, NODE_ENV } from './config/index.js';
import { logger } from './utils/logger.js';
import { websocketService } from './services/websocket.js';
import { schedulerService } from './services/scheduler.js';
import { telegramService } from './services/telegram.js';

// Import routes
import poolsRoutes from './routes/pools.js';
import portfoliosRoutes from './routes/portfolios.js';
import systemRoutes from './routes/system.js';
import scraperRoutes from './routes/scraper.js';
import { defiLlamaScraper } from './services/scraper.js';

// Create Express app
const app = express();
const server = createServer(app);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: NODE_ENV === 'production',
}));

app.use(cors({
  origin: NODE_ENV === 'development' 
    ? ['http://localhost:3000', 'http://127.0.0.1:3000'] 
    : false,
  credentials: true,
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use((req, res, next) => {
  logger.debug(`${req.method} ${req.path}`, {
    ip: req.ip,
    query: req.query,
  });
  next();
});

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    environment: NODE_ENV,
    paperTrading: config.paperTrading,
  });
});

// API Routes
app.use('/api/pools', poolsRoutes);
app.use('/api/portfolios', portfoliosRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/scraper', scraperRoutes);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
  });
});

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error', err);
  
  res.status(500).json({
    success: false,
    error: NODE_ENV === 'production' ? 'Internal server error' : err.message,
    stack: NODE_ENV === 'production' ? undefined : err.stack,
  });
});

// Graceful shutdown
const gracefulShutdown = async (signal: string) => {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);
  
  // Stop scheduler
  schedulerService.stop();
  
  // Close WebSocket server
  websocketService.stop();
  
  // Close scraper browser
  try {
    await defiLlamaScraper.close();
    logger.info('Scraper closed');
  } catch (error) {
    logger.error('Error closing scraper', error as Error);
  }
  
  // Close HTTP server
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });

  // Force shutdown after 10 seconds
  setTimeout(() => {
    logger.error('Forced shutdown due to timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', error);
  telegramService.notifyError('Uncaught exception', error);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection', new Error(String(reason)), { promise });
  telegramService.notifyError('Unhandled rejection', new Error(String(reason)));
});

// Start server
server.listen(PORT, async () => {
  logger.info(`DarkYield server running on port ${PORT}`);
  logger.info(`Environment: ${NODE_ENV}`);
  logger.info(`Paper Trading: ${config.paperTrading ? 'ENABLED' : 'DISABLED'}`);

  // Initialize WebSocket server
  websocketService.initialize(server);
  logger.info('WebSocket server initialized on /ws');

  // Test Telegram connection
  if (config.telegram) {
    const connected = await telegramService.testConnection();
    if (connected) {
      await telegramService.notifyStartup();
    }
  }

  // Start scheduler if auto-start enabled (can be disabled via env)
  if (process.env.AUTO_START_SCHEDULER !== 'false') {
    schedulerService.start();
  }
});

export default app;
