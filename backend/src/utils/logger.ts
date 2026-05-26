import winston from 'winston';
import { LOG_LEVEL, NODE_ENV } from '../config/index.js';

const { combine, timestamp, json, errors, printf, colorize } = winston.format;

// Safe JSON stringify that handles circular references
const safeStringify = (obj: unknown): string => {
  const seen = new WeakSet();
  return JSON.stringify(obj, (key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular]';
      }
      seen.add(value);
    }
    return value;
  });
};

// Custom format for development
const devFormat = printf(({ level, message, timestamp, ...metadata }) => {
  let msg = `${timestamp} [${level}]: ${message}`;
  if (Object.keys(metadata).length > 0) {
    try {
      msg += ` ${safeStringify(metadata)}`;
    } catch (e) {
      msg += ` [metadata stringify error]`;
    }
  }
  return msg;
});

// Create the logger instance
export const logger = winston.createLogger({
  level: LOG_LEVEL,
  defaultMeta: { service: 'darkyield' },
  transports: [
    new winston.transports.Console({
      format: combine(
        timestamp(),
        errors({ stack: true }),
        NODE_ENV === 'development' ? combine(colorize(), devFormat) : json()
      ),
    }),
  ],
});

// Add file transports in production
if (NODE_ENV === 'production') {
  logger.add(new winston.transports.File({
    filename: 'logs/error.log',
    level: 'error',
    format: combine(timestamp(), json()),
  }));
  logger.add(new winston.transports.File({
    filename: 'logs/combined.log',
    format: combine(timestamp(), json()),
  }));
}

// Helper functions for common log patterns
export const logPoolUpdate = (poolId: string, changes: Record<string, unknown>) => {
  logger.debug('Pool update', { poolId, changes });
};

export const logRebalance = (planId: string, action: string, details: Record<string, unknown>) => {
  logger.info('Rebalance action', { planId, action, ...details });
};

export const logRiskAlert = (level: string, trigger: string, message: string) => {
  logger.warn('Risk alert triggered', { level, trigger, message });
};

export const logTrade = (type: string, poolId: string, amount: number, fees: number) => {
  logger.info('Trade executed', { type, poolId, amount, fees });
};

export const logError = (context: string, error: Error, metadata?: Record<string, unknown>) => {
  logger.error(context, { error: error.message, stack: error.stack, ...metadata });
};
