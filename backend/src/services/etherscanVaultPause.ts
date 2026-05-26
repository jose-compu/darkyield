import axios from 'axios';
import { id, Interface } from 'ethers';
import type { Pool } from '../../../shared/types/index.js';
import { logger } from '../utils/logger.js';

const ETHERSCAN_V2 = 'https://api.etherscan.io/v2/api';

/** DefiLlama `pool.chain` display name → numeric chain id for Etherscan API v2. */
const LLAMA_CHAIN_TO_CHAIN_ID: Record<string, number> = {
  Ethereum: 1,
  Arbitrum: 42161,
  Optimism: 10,
  Base: 8453,
  Polygon: 137,
  Avalanche: 43114,
  BSC: 56,
  Fantom: 250,
  Gnosis: 100,
  Cronos: 25,
  Metis: 1088,
  Mantle: 5000,
  Celo: 42220,
  Moonbeam: 1284,
  Moonriver: 1285,
  Linea: 59144,
  Blast: 81457,
  Scroll: 534352,
  'ZkSync Era': 324,
  'zkSync Era': 324,
  Mode: 34443,
  Manta: 169,
  'Polygon zkEVM': 1101,
  opBNB: 204,
  Kava: 2222,
  Aurora: 1313161554,
  Harmony: 1666600000,
  Fuse: 122,
  Boba: 288,
  Zora: 7777777,
  Fraxtal: 252,
  'X Layer': 196,
  Taiko: 167000,
  'World Chain': 480,
  Ink: 57073,
  Lisk: 1135,
  Soneium: 1868,
  Unichain: 130,
  Swan: 254,
  'Immutable zkEVM': 13371,
  Astar: 592,
  Kroma: 255,
  'Ethereum Classic': 61,
  Flare: 14,
  XDC: 50,
  Merlin: 4200,
};

const PAUSE_SELECTORS: readonly string[] = [
  id('depositPaused()').slice(0, 10),
  id('depositsPaused()').slice(0, 10),
  id('paused()').slice(0, 10),
  id('isPaused()').slice(0, 10),
];

/** ERC-4626: maxDeposit(address) — returns 0 when deposits are not possible (incl. many Morpho/MetaMorpho vaults). */
const ERC4626_IFACE = new Interface([
  'function maxDeposit(address receiver) view returns (uint256)',
]);
const MAX_DEPOSIT_DUMMY = '0x0000000000000000000000000000000000000001';

const EVM_ADDR = /^0x[a-fA-F0-9]{40}$/;

/** In-memory cache: `${chainId}:${addr}` → paused + timestamp */
const pauseCache = new Map<string, { paused: boolean; ts: number }>();

let roundRobinOffset = 0;

function parseEnvInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function getApiKey(): string | undefined {
  const k = process.env.ETHERSCAN_API_KEY?.trim();
  return k || undefined;
}

function isPauseCheckEnabled(): boolean {
  return process.env.ETHERSCAN_PAUSE_CHECK !== 'false' && !!getApiKey();
}

function cacheTtlMs(): number {
  return parseEnvInt('ETHERSCAN_PAUSE_CACHE_MS', 60 * 60 * 1000);
}

function batchSize(): number {
  return parseEnvInt('ETHERSCAN_PAUSE_BATCH', 50);
}

function requestDelayMs(): number {
  return parseEnvInt('ETHERSCAN_PAUSE_DELAY_MS', 80);
}

function chainIdForPool(pool: Pool): number | undefined {
  return LLAMA_CHAIN_TO_CHAIN_ID[pool.chain.trim()];
}

function isEvmPoolContractId(poolId: string): boolean {
  return EVM_ADDR.test(poolId.trim());
}

function cacheKey(chainId: number, address: string): string {
  return `${chainId}:${address.toLowerCase()}`;
}

function decodeAbiBool(resultHex: string): boolean {
  const h = resultHex.replace(/^0x/i, '');
  if (h.length < 64) return false;
  const lastByte = parseInt(h.slice(-2), 16);
  return lastByte !== 0;
}

type EthCallJson = {
  status?: string;
  result?: string;
  error?: { code?: number; message?: string };
};

async function ethCallBool(
  apiKey: string,
  chainId: number,
  to: string,
  data: string
): Promise<{ ok: true; value: boolean } | { ok: false }> {
  try {
    const { data: res } = await axios.get<EthCallJson>(ETHERSCAN_V2, {
      params: {
        chainid: chainId,
        module: 'proxy',
        action: 'eth_call',
        to: to,
        data,
        tag: 'latest',
        apikey: apiKey,
      },
      timeout: 20000,
    });

    // Etherscan API v2 returns JSON-RPC: { result: "0x..." } on success, or { error: {...} } on revert
    if (res.error) {
      return { ok: false };
    }
    if (typeof res.result === 'string' && /^0x[0-9a-fA-F]+$/.test(res.result)) {
      return { ok: true, value: decodeAbiBool(res.result) };
    }
    // Legacy shape: { status: "1", result: "0x..." }
    if (res.status === '1' && typeof res.result === 'string' && /^0x[0-9a-fA-F]+$/.test(res.result)) {
      return { ok: true, value: decodeAbiBool(res.result) };
    }
    return { ok: false };
  } catch (e) {
    logger.debug('Etherscan eth_call failed', {
      chainId,
      to,
      error: (e as Error).message,
    });
    return { ok: false };
  }
}

async function ethCallHex(
  apiKey: string,
  chainId: number,
  to: string,
  data: string
): Promise<string | null> {
  try {
    const { data: res } = await axios.get<EthCallJson>(ETHERSCAN_V2, {
      params: {
        chainid: chainId,
        module: 'proxy',
        action: 'eth_call',
        to: to,
        data,
        tag: 'latest',
        apikey: apiKey,
      },
      timeout: 20000,
    });
    if (res.error) return null;
    if (typeof res.result === 'string' && /^0x[0-9a-fA-F]+$/.test(res.result)) {
      return res.result;
    }
    if (res.status === '1' && typeof res.result === 'string' && /^0x[0-9a-fA-F]+$/.test(res.result)) {
      return res.result;
    }
    return null;
  } catch {
    return null;
  }
}

function decodeUint256Hex(resultHex: string): bigint | null {
  try {
    return BigInt(resultHex);
  } catch {
    return null;
  }
}

/** True if maxDeposit(dummy) is exactly 0 (deposits closed per ERC-4626 semantics). */
async function maxDepositIsZero(
  apiKey: string,
  chainId: number,
  vaultAddress: string
): Promise<boolean | null> {
  const data = ERC4626_IFACE.encodeFunctionData('maxDeposit', [MAX_DEPOSIT_DUMMY]);
  const raw = await ethCallHex(apiKey, chainId, vaultAddress, data);
  if (!raw) return null;
  const v = decodeUint256Hex(raw);
  if (v === null) return null;
  return v === 0n;
}

/**
 * Returns true if any common pause/deposit-pause view returns true.
 * false = we got at least one successful read and none indicated pause.
 * null = could not determine (unsupported chain, not a contract, all calls failed).
 */
export async function checkVaultDepositsPaused(
  apiKey: string,
  chainId: number,
  vaultAddress: string
): Promise<boolean | null> {
  const addr = vaultAddress.trim();
  if (!EVM_ADDR.test(addr)) return null;

  let anySuccess = false;

  for (const sel of PAUSE_SELECTORS) {
    const r = await ethCallBool(apiKey, chainId, addr, sel);
    if (!r.ok) continue;
    anySuccess = true;
    if (r.value) return true;
  }

  const maxZ = await maxDepositIsZero(apiKey, chainId, addr);
  if (maxZ === true) return true;

  if (!anySuccess) return null;
  return false;
}

/**
 * Marks pools inactive when on-chain pause/deposit-pause reads return true.
 * Uses caching + round-robin batching to stay within API limits.
 */
export async function enrichPoolsWithDepositPauseFlags(pools: Pool[]): Promise<void> {
  if (process.env.JEST_WORKER_ID != null) return;
  if (!isPauseCheckEnabled()) return;

  const apiKey = getApiKey()!;
  const ttl = cacheTtlMs();
  const now = Date.now();
  const batch = batchSize();
  const delay = requestDelayMs();

  const candidates = pools
    .filter((p) => {
      const cid = chainIdForPool(p);
      return cid !== undefined && isEvmPoolContractId(p.id);
    })
    .sort((a, b) => b.tvlUsd - a.tvlUsd);

  if (candidates.length === 0) return;

  const n = candidates.length;
  const toProbe: Pool[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < Math.min(batch, n); i++) {
    const idx = (roundRobinOffset + i) % n;
    const p = candidates[idx];
    const cid = chainIdForPool(p)!;
    const ck = cacheKey(cid, p.id);
    if (seen.has(ck)) continue;
    seen.add(ck);
    const hit = pauseCache.get(ck);
    if (hit && now - hit.ts < ttl) {
      if (hit.paused) p.inactive = true;
      continue;
    }
    toProbe.push(p);
  }

  roundRobinOffset = (roundRobinOffset + Math.min(batch, n)) % Math.max(n, 1);

  for (const p of toProbe) {
    const cid = chainIdForPool(p)!;
    const ck = cacheKey(cid, p.id);
    const paused = await checkVaultDepositsPaused(apiKey, cid, p.id);
    if (paused === true) {
      pauseCache.set(ck, { paused: true, ts: now });
      p.inactive = true;
    } else if (paused === false) {
      pauseCache.set(ck, { paused: false, ts: now });
    }
    await new Promise((r) => setTimeout(r, delay));
  }
}
