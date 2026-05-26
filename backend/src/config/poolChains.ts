/**
 * DefiLlama yields API uses display names in `pool.chain` (e.g. "Ethereum", "Arbitrum").
 * When `POOL_CHAIN_FILTER_MODE=evm_only` (default), only chains in this allowlist are kept.
 *
 * To show Solana and other networks again: set `POOL_CHAIN_FILTER_MODE=all` in env.
 * To support a new EVM L2: add its exact DefiLlama chain name here.
 */
export const EVM_COMPATIBLE_LLAMA_CHAIN_NAMES = new Set<string>([
  'Ethereum',
  'Arbitrum',
  'Optimism',
  'Base',
  'Polygon',
  'Avalanche',
  'BSC',
  'Fantom',
  'Gnosis',
  'Cronos',
  'Metis',
  'Mantle',
  'Celo',
  'Moonbeam',
  'Moonriver',
  'Linea',
  'Blast',
  'Scroll',
  'ZkSync Era',
  'zkSync Era',
  'Mode',
  'Manta',
  'Polygon zkEVM',
  'opBNB',
  'Kava',
  'Aurora',
  'Harmony',
  'Fuse',
  'Boba',
  'Zora',
  'Fraxtal',
  'X Layer',
  'Taiko',
  'World Chain',
  'Ink',
  'Lisk',
  'Soneium',
  'Unichain',
  'Swan',
  'Immutable zkEVM',
  'Astar',
  'Kroma',
  'Ethereum Classic',
  'Flare',
  'XDC',
  'Merlin',
]);

export type PoolChainFilterMode = 'evm_only' | 'all';

export function parsePoolChainFilterMode(raw: string | undefined): PoolChainFilterMode {
  if (raw === 'all') {
    return 'all';
  }
  return 'evm_only';
}

export function isEvmCompatibleLlamaChain(chainName: string): boolean {
  const c = chainName.trim();
  return EVM_COMPATIBLE_LLAMA_CHAIN_NAMES.has(c);
}
