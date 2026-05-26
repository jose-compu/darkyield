import path from 'path';
import dotenv from 'dotenv';
import { SystemConfig, RebalanceFrequency, RiskLevel } from '../../../shared/types/index.js';
import { parsePoolChainFilterMode } from './poolChains.js';

/** EVM allowlist + helpers — extend `EVM_COMPATIBLE_LLAMA_CHAIN_NAMES` when new L2s are needed. */
export * from './poolChains.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '..', '.env') });

function parseEnvFloat(name: string, fallback: number, min: number, max: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export const config: SystemConfig = {
  defiLlamaApiUrl: process.env.DEFILLAMA_API_URL || 'https://yields.llama.fi',
  poolChainFilterMode: parsePoolChainFilterMode(process.env.POOL_CHAIN_FILTER_MODE),
  poolMaxApyPercent: parseEnvFloat('POOL_MAX_APY_PERCENT', 1000, 1, 1_000_000),
  poolMaxApyPercentHardCap: parseEnvFloat('POOL_MAX_APY_PERCENT_HARD_CAP', 50_000, 100, 2_000_000),
  defaultRebalanceFrequency: (process.env.DEFAULT_REBALANCE_FREQUENCY as RebalanceFrequency) || RebalanceFrequency.DAILY,
  minRebalanceInterval: parseInt(process.env.MIN_REBALANCE_INTERVAL || '60', 10), // minutes
  riskCheckInterval: parseInt(process.env.RISK_CHECK_INTERVAL || '60', 10), // minutes
  paperTrading: process.env.PAPER_TRADING === 'true' || true,
  maxConcurrentPositions: parseInt(process.env.MAX_CONCURRENT_POSITIONS || '10', 10),
  defaultRiskTriggers: [
    {
      type: 'TVL_DROP',
      threshold: 30, // 30% TVL drop
      action: 'EXIT',
      cooldownMinutes: 60,
    },
    {
      type: 'APY_DROP',
      threshold: 50, // 50% APY drop from entry
      action: 'EXIT',
      cooldownMinutes: 120,
    },
    {
      type: 'VOLATILITY_SPIKE',
      threshold: 3, // 3x normal volatility
      action: 'ALERT',
      cooldownMinutes: 30,
    },
    {
      type: 'MAX_DRAWDOWN',
      threshold: 15, // 15% max drawdown
      action: 'REDUCE',
      cooldownMinutes: 60,
    },
  ],
  telegram: process.env.TELEGRAM_BOT_TOKEN ? {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID || '',
    notifications: {
      rebalance: true,
      riskAlert: true,
      performance: true,
      dailySummary: true,
      error: true,
    },
  } : undefined,
  rpcEndpoints: {
    ethereum: process.env.ETHEREUM_RPC || 'https://eth.llamarpc.com',
    arbitrum: process.env.ARBITRUM_RPC || 'https://arb.llamarpc.com',
    optimism: process.env.OPTIMISM_RPC || 'https://opt.llamarpc.com',
    base: process.env.BASE_RPC || 'https://base.llamarpc.com',
    polygon: process.env.POLYGON_RPC || 'https://polygon.llamarpc.com',
    bsc: process.env.BSC_RPC || 'https://binance.llamarpc.com',
    avax: process.env.AVAX_RPC || 'https://avax.llamarpc.com',
    fantom: process.env.FANTOM_RPC || 'https://fantom.llamarpc.com',
  },
  walletConfig: process.env.WALLET_ADDRESS ? {
    address: process.env.WALLET_ADDRESS,
    encryptedKey: process.env.ENCRYPTED_PRIVATE_KEY,
  } : undefined,
};

export const PORT = parseInt(process.env.PORT || '4000', 10);
export const NODE_ENV = process.env.NODE_ENV || 'development';
export const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

// Chain IDs for EVM compatibility
export const CHAIN_IDS: Record<string, number> = {
  ethereum: 1,
  arbitrum: 42161,
  optimism: 10,
  base: 8453,
  polygon: 137,
  bsc: 56,
  avax: 43114,
  fantom: 250,
};

// Token addresses for major stablecoins
export const STABLECOIN_ADDRESSES: Record<string, Record<string, string>> = {
  ethereum: {
    USDC: '0xA0b86a33E6441e0aDA2e87046AeaBe8BC2C03c0F',
    USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    DAI: '0x6B175474E89094C44Da98b954EedeAC495271d0F',
    FRAX: '0x853d955aCEf822Db058eb8505911ED77F175b99e',
    crvUSD: '0xf939E0A03FB07F59A73314E73794Be0E57ac1b4E',
  },
  arbitrum: {
    USDC: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    USDT: '0xFd086bC7CD5C481DCC9C85ebE478A1c0b69FCbb9',
    DAI: '0xDA10009cBd5D07dd0CeCc66161FC93D7cD9000C1',
  },
  optimism: {
    USDC: '0x7F5c764cBc14f9669B88837ca1490cCa17c31607',
    USDT: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58',
    DAI: '0xDA10009cBd5D07dd0CeCc66161FC93D7cD9000C1',
  },
  base: {
    USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    USDT: '0xfde4C96c8593536E31F229EA9f0c15B3ED6f55E0',
    DAI: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
  },
};

// Known token symbols that are stablecoins
export const STABLECOIN_SYMBOLS = [
  'USDC', 'USDT', 'DAI', 'FRAX', 'USDC.E', 'USDT0', 'TUSD',
  'BUSD', 'GUSD', 'PAX', 'USDP', 'SUSD', 'LUSD', 'crvUSD',
  'GHO', 'sUSDe', 'USDe', 'EUSD', 'DOLA', 'USDM', 'USR',
  'USD0', 'sDAI', 'aDAI', 'cUSDC', 'cDAI', 'yCRV', 'yUSD',
];

// Yield pool categories by risk
export const POOL_CATEGORIES: Record<string, string[]> = {
  'lending': ['aave', 'compound', 'morpho', 'spark', 'radiant', 'benqi', 'tender'],
  'dex': ['uniswap', 'curve', 'balancer', 'sushiswap', 'pancakeswap', 'trader-joe'],
  'yield-aggregator': ['yearn', 'convex', 'beefy', 'harvest', 'vault'],
  'liquid-staking': ['lido', 'rocket-pool', 'frax-ether', 'coinbase-wrapped', 'stakewise'],
  'perpetual': ['gmx', 'gains-network', 'mux', 'level', 'vela'],
  'cdp': ['maker', 'liquity', 'raft', 'prisma', 'graviton'],
};
