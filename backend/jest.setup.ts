// Jest setup file
import { jest } from '@jest/globals';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.test' });

// Mock console methods during tests
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};
