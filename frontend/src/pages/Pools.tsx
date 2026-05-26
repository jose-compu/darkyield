import { useState, Fragment } from 'react'
import { usePools, useStablecoinPools, useChains } from '../hooks/useApi'
import { 
  Search, 
  Filter, 
  TrendingUp, 
  Shield, 
  AlertTriangle,
  Flame,
  ChevronDown,
  ChevronUp,
  ExternalLink
} from 'lucide-react'
import { Pool, YieldMode } from '../../../shared/types'
import {
  loadApyCeiling,
  loadIncludeOutliers,
  saveApyCeiling,
  saveIncludeOutliers,
} from '../lib/poolFilters'

type SortKey = 'pool' | 'apy' | 'tvl' | 'chain' | 'risk' | 'volatility' | 'outlook'

const DEFAULT_SORT_DESC: Record<SortKey, boolean> = {
  pool: false,
  apy: true,
  tvl: true,
  chain: false,
  risk: true,
  volatility: true,
  outlook: true,
}

/**
 * DefiLlama `ilRisk: 'no'` is a coarse flag: low *classical* IL vs volatile pairs.
 * Multi-asset AMMs (e.g. Uni v3) are often tagged `no` for stable/correlated pairs (tBTC/WBTC);
 * that means small relative divergence, not literally zero LP risk (peg drift, range, bridges).
 */
function ilRiskNoBadgeLabel(pool: Pool): string {
  if (pool.exposure === 'single') return 'No IL Risk'
  return 'Minimal IL (index)'
}

/** Linear annualization of DefiLlama %ΔAPY over a window (not an ML forecast). */
function annualizeApyDeltaPct(delta: number, periodDays: number): number {
  return delta * (365 / periodDays)
}

/** Sort key: ML min APY when present, else annualized 7d APY-momentum (fallback 30d). */
function outlookSortValue(p: Pool): number | null {
  if (p.apyPrediction) {
    return p.apyPrediction.predictedMinApy ?? p.apyPrediction.currentApy ?? 0
  }
  if (p.apyTrend7d != null) return annualizeApyDeltaPct(p.apyTrend7d, 7)
  if (p.apyTrend30d != null) return annualizeApyDeltaPct(p.apyTrend30d, 30)
  return null
}

function comparePools(a: Pool, b: Pool, sortBy: SortKey, sortDesc: boolean): number {
  if (sortBy === 'pool') {
    const sa = `${a.symbol} ${a.project}`.toLowerCase()
    const sb = `${b.symbol} ${b.project}`.toLowerCase()
    const c = sa.localeCompare(sb, undefined, { sensitivity: 'base' })
    return sortDesc ? -c : c
  }
  if (sortBy === 'chain') {
    const c = a.chain.localeCompare(b.chain, undefined, { sensitivity: 'base' })
    return sortDesc ? -c : c
  }

  if (sortBy === 'outlook') {
    const oa = outlookSortValue(a)
    const ob = outlookSortValue(b)
    if (oa === null && ob === null) return 0
    if (oa === null) return 1
    if (ob === null) return -1
    return sortDesc ? ob - oa : oa - ob
  }

  const num = (p: Pool): number => {
    switch (sortBy) {
      case 'apy':
        return p.apy
      case 'tvl':
        return p.tvlUsd
      case 'risk':
        return p.riskScore ?? 50
      case 'volatility':
        return p.volatilityScore ?? 0
      default:
        return 0
    }
  }
  const na = num(a)
  const nb = num(b)
  return sortDesc ? nb - na : na - nb
}

function Pools() {
  const [mode, setMode] = useState<YieldMode>(YieldMode.STABLECOINS)
  const [search, setSearch] = useState('')
  const [minTvl, setMinTvl] = useState(1000000)
  const [expandedPool, setExpandedPool] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<SortKey>('apy')
  const [sortDesc, setSortDesc] = useState(true)

  const handleSort = (column: SortKey) => {
    if (column === sortBy) {
      setSortDesc((d) => !d)
    } else {
      setSortBy(column)
      setSortDesc(DEFAULT_SORT_DESC[column])
    }
  }
  const [showInactive, setShowInactive] = useState(false)
  const [apyCeiling, setApyCeiling] = useState(() => loadApyCeiling(1000))
  const [showApyOutliers, setShowApyOutliers] = useState(() => loadIncludeOutliers())

  const { data: pools, isLoading } = usePools({
    mode,
    minTvl,
    stablecoinsOnly: mode === YieldMode.STABLECOINS,
    excludeILRisk: mode === YieldMode.STABLECOINS,
    limit: 100,
    includeInactive: showInactive,
    maxReasonableApyPercent: apyCeiling,
    includeApyOutliers: showApyOutliers,
  })

  const { data: chains } = useChains()

  // Filter and sort pools
  const filteredPools = pools?.filter(pool => {
    const searchLower = search.toLowerCase()
    return (
      pool.symbol.toLowerCase().includes(searchLower) ||
      pool.project.toLowerCase().includes(searchLower) ||
      pool.chain.toLowerCase().includes(searchLower)
    )
  }) || []

  const sortedPools = [...filteredPools].sort((a, b) => comparePools(a, b, sortBy, sortDesc))

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-[var(--color-text)]">Yield Pools</h2>
        <p className="text-[var(--color-text-muted)] mt-1">
          Discover and analyze yield farming opportunities across DeFi
        </p>
      </div>

      {/* Mode Selection */}
      <div className="flex flex-wrap gap-2">
        <ModeButton active={mode === YieldMode.STABLECOINS} onClick={() => setMode(YieldMode.STABLECOINS)}>
          <Shield className="w-4 h-4 mr-2" />
          Stablecoins
        </ModeButton>
        <ModeButton active={mode === YieldMode.BLUECHIPS} onClick={() => setMode(YieldMode.BLUECHIPS)}>
          <TrendingUp className="w-4 h-4 mr-2" />
          Bluechips (Top 200)
        </ModeButton>
        <ModeButton active={mode === YieldMode.LONGTAIL} onClick={() => setMode(YieldMode.LONGTAIL)}>
          <AlertTriangle className="w-4 h-4 mr-2" />
          Long Tail (Beyond Top 200)
        </ModeButton>
        <ModeButton active={mode === YieldMode.MEMECOINS} onClick={() => setMode(YieldMode.MEMECOINS)}>
          <Flame className="w-4 h-4 mr-2" />
          Memecoins
        </ModeButton>
      </div>

      {/* Mode Description */}
      <div className="card py-3 px-4 bg-[var(--color-surface-hover)]">
        <p className="text-sm text-[var(--color-text-muted)]">
          {mode === YieldMode.STABLECOINS && (
            <>
              <strong className="text-[var(--color-text)]">Stablecoins:</strong> USDC, USDT, DAI and other stable assets. Low risk, low volatility yields.
            </>
          )}
          {mode === YieldMode.BLUECHIPS && (
            <>
              <strong className="text-[var(--color-text)]">Bluechips (Top 200):</strong> ETH, WBTC, SOL, AVAX, and major DeFi tokens (AAVE, UNI, LINK, LDO, etc.). 
              Established projects with proven track records (memecoin pools are listed separately).
            </>
          )}
          {mode === YieldMode.LONGTAIL && (
            <>
              <strong className="text-[var(--color-text)]">Long Tail:</strong> Emerging tokens outside the Top 200 market cap (excludes memecoin pools). Higher potential yields with increased risk.
            </>
          )}
          {mode === YieldMode.MEMECOINS && (
            <>
              <strong className="text-[var(--color-text)]">Memecoins:</strong> Yields where the asset matches our memecoin list or CoinGecko (trending, 24h movers, meme-token category). Spot volatility uses a realistic floor for memes. Very high risk; not shown under Bluechips or Long Tail.
            </>
          )}
        </p>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="flex flex-col lg:flex-row gap-4">
          {/* Search */}
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--color-text-muted)]" />
            <input
              type="text"
              placeholder="Search pools, protocols, or chains..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input pl-10"
            />
          </div>

          {/* Min TVL Filter */}
          <div className="flex items-center gap-2">
            <Filter className="w-5 h-5 text-[var(--color-text-muted)]" />
            <select
              value={minTvl}
              onChange={(e) => setMinTvl(Number(e.target.value))}
              className="select w-48"
            >
              <option value={100000}>Min TVL: $100K</option>
              <option value={500000}>Min TVL: $500K</option>
              <option value={1000000}>Min TVL: $1M</option>
              <option value={5000000}>Min TVL: $5M</option>
              <option value={10000000}>Min TVL: $10M</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] cursor-pointer whitespace-nowrap">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="rounded border-[var(--color-border)]"
            />
            Show inactive (0% APY)
          </label>
          <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--color-text-muted)]">
            <label className="whitespace-nowrap">Max APY (%)</label>
            <input
              type="number"
              min={1}
              max={50000}
              step={1}
              value={apyCeiling}
              onChange={(e) => setApyCeiling(Number(e.target.value))}
              onBlur={() => saveApyCeiling(apyCeiling)}
              className="input w-24 py-1 text-sm"
              title="Hide pools with reported APY above this (stale metrics, closed vaults)"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] cursor-pointer whitespace-nowrap">
            <input
              type="checkbox"
              checked={showApyOutliers}
              onChange={(e) => {
                const v = e.target.checked
                setShowApyOutliers(v)
                saveIncludeOutliers(v)
              }}
              className="rounded border-[var(--color-border)]"
            />
            Show APY outliers
          </label>
        </div>

        {/* Stats Bar */}
        <div className="flex flex-wrap gap-4 mt-4 pt-4 border-t border-[var(--color-border)] text-sm text-[var(--color-text-muted)]">
          <span>Total Pools: {pools?.length || 0}</span>
          <span>Filtered: {filteredPools.length}</span>
          <span>Avg APY: {filteredPools.length > 0 
            ? (filteredPools.reduce((sum, p) => sum + p.apy, 0) / filteredPools.length).toFixed(2) 
            : 0}%</span>
        </div>
      </div>

      {/* Pools Table */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="text-center py-12">
            <div className="animate-spin w-8 h-8 border-2 border-[var(--color-primary)] border-t-transparent rounded-full mx-auto" />
            <p className="mt-4 text-[var(--color-text-muted)]">Loading pools...</p>
          </div>
        ) : sortedPools.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-[var(--color-text-muted)]">No pools found matching your criteria</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <SortableTh label="Pool" column="pool" sortBy={sortBy} sortDesc={sortDesc} onSort={handleSort} />
                  <SortableTh label="APY" column="apy" sortBy={sortBy} sortDesc={sortDesc} onSort={handleSort} />
                  <SortableTh label="TVL" column="tvl" sortBy={sortBy} sortDesc={sortDesc} onSort={handleSort} />
                  <SortableTh label="Chain" column="chain" sortBy={sortBy} sortDesc={sortDesc} onSort={handleSort} />
                  <SortableTh label="Risk" column="risk" sortBy={sortBy} sortDesc={sortDesc} onSort={handleSort} />
                  <SortableTh label="Volatility" column="volatility" sortBy={sortBy} sortDesc={sortDesc} onSort={handleSort} />
                  <SortableTh label="Outlook" column="outlook" sortBy={sortBy} sortDesc={sortDesc} onSort={handleSort} />
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedPools.map((pool) => (
                  <Fragment key={pool.id}>
                    <tr 
                      className="cursor-pointer"
                      onClick={() => setExpandedPool(expandedPool === pool.id ? null : pool.id)}
                    >
                      <td>
                        <div>
                          <div className="font-medium text-[var(--color-text)] flex items-center gap-2 flex-wrap">
                            {pool.symbol}
                            {pool.inactive && (
                              <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-[var(--color-surface-hover)] text-[var(--color-text-muted)] border border-[var(--color-border)]">
                                Inactive
                              </span>
                            )}
                            {pool.apyOutlier && (
                              <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/40">
                                Outlier APY
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-[var(--color-text-muted)]">{pool.project}</div>
                        </div>
                      </td>
                      <td>
                        <APYBadge apy={pool.apy} />
                      </td>
                      <td className="font-mono">
                        ${(pool.tvlUsd / 1_000_000).toFixed(2)}M
                      </td>
                      <td>
                        <span className="text-sm text-[var(--color-text-muted)]">{pool.chain}</span>
                      </td>
                      <td>
                        <RiskScore score={pool.riskScore || 50} />
                      </td>
                      <td>
                        <VolatilityBadge score={pool.volatilityScore} />
                      </td>
                      <td>
                        <OutlookCell pool={pool} />
                      </td>
                      <td
                        className="align-top"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex flex-col gap-2 min-w-[7rem]">
                          <PoolSourceLinks pool={pool} compact />
                          <button
                            type="button"
                            className="text-sm text-[var(--color-primary)] hover:underline text-left"
                            onClick={() =>
                              setExpandedPool(expandedPool === pool.id ? null : pool.id)
                            }
                          >
                            Details
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expandedPool === pool.id && (
                      <tr>
                        <td colSpan={8} className="bg-[var(--color-surface-hover)] p-4">
                          <PoolDetails pool={pool} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

/** DefiLlama yields UI for this pool id (same id as API). */
function defillamaPoolUrl(poolId: string): string {
  return `https://defillama.com/yields/pool/${encodeURIComponent(poolId)}`
}

function PoolSourceLinks({
  pool,
  compact,
}: {
  pool: Pool
  /** Table row: shorter labels */
  compact?: boolean
}) {
  const llama = defillamaPoolUrl(pool.id)
  const linkClass =
    'inline-flex items-center gap-0.5 text-[var(--color-primary)] hover:underline'
  const subLinkClass =
    'inline-flex items-center gap-0.5 text-[var(--color-text-muted)] hover:text-[var(--color-primary)] hover:underline'

  return (
    <div
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${compact ? 'text-xs' : 'text-sm'}`}
      onClick={(e) => e.stopPropagation()}
    >
      {pool.url && (
        <a
          href={pool.url}
          target="_blank"
          rel="noopener noreferrer"
          className={linkClass}
        >
          <ExternalLink className="w-3.5 h-3.5 shrink-0" />
          {compact ? 'Vault' : 'Open vault (protocol)'}
        </a>
      )}
      <a href={llama} target="_blank" rel="noopener noreferrer" className={pool.url ? subLinkClass : linkClass}>
        <ExternalLink className="w-3.5 h-3.5 shrink-0" />
        {compact ? 'Llama' : 'View on DefiLlama'}
      </a>
    </div>
  )
}

function SortableTh({
  label,
  column,
  sortBy,
  sortDesc,
  onSort,
}: {
  label: string
  column: SortKey
  sortBy: SortKey
  sortDesc: boolean
  onSort: (column: SortKey) => void
}) {
  const active = sortBy === column
  return (
    <th
      className="cursor-pointer select-none hover:bg-[var(--color-surface-hover)]"
      onClick={() => onSort(column)}
      scope="col"
    >
      <div className="flex items-center gap-1">
        {label}
        {active && (sortDesc ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronUp className="w-4 h-4 shrink-0" />)}
      </div>
    </th>
  )
}

// Components
function ModeButton({ 
  children, 
  active, 
  onClick 
}: { 
  children: React.ReactNode
  active: boolean
  onClick: () => void 
}) {
  return (
    <button
      onClick={onClick}
      className={`btn ${active ? 'btn-primary' : 'btn-secondary'}`}
    >
      {children}
    </button>
  )
}

function APYBadge({ apy }: { apy: number }) {
  let className = 'yield-low'
  if (apy > 50) className = 'yield-extreme'
  else if (apy > 20) className = 'yield-high'
  else if (apy > 10) className = 'yield-medium'

  return (
    <span className={`font-mono font-bold ${className}`}>
      {apy.toFixed(2)}%
    </span>
  )
}

function RiskScore({ score }: { score: number }) {
  let level = 'Low'
  let color = 'bg-green-500'

  if (score > 80) {
    level = 'Extreme'
    color = 'bg-red-500'
  } else if (score > 60) {
    level = 'High'
    color = 'bg-yellow-500'
  } else if (score > 40) {
    level = 'Moderate'
    color = 'bg-blue-500'
  }

  return (
    <div className="flex items-center gap-2">
      <div className={`w-2 h-2 rounded-full ${color}`} />
      <span className="text-sm text-[var(--color-text-muted)]">{level}</span>
      <span className="text-xs text-[var(--color-text-subtle)]">({score})</span>
    </div>
  )
}

function VolatilityBadge({ score }: { score?: number }) {
  if (score === undefined || score === null || score < 0.05) {
    return (
      <span className="text-xs text-[var(--color-text-muted)]">-</span>
    )
  }

  // Annualized volatility percentage
  const annualizedVol = score.toFixed(1)

  let color = 'text-green-500'
  let level = 'Low'

  if (score > 35) {
    color = 'text-red-500'
    level = 'High'
  } else if (score > 20) {
    color = 'text-yellow-500'
    level = 'Med'
  }

  return (
    <div className="flex flex-col">
      <span className={`text-sm font-medium ${color}`}>{annualizedVol}%</span>
      <span className="text-xs text-[var(--color-text-subtle)]">{level}</span>
    </div>
  )
}

function PredictionBadge({
  prediction,
}: {
  prediction: {
    confidence: 'LOW' | 'MEDIUM' | 'HIGH'
    predictedMinApy: number
    currentApy: number
    timeframe?: string
    predictedMaxApy?: number
  }
}) {
  const confidenceColors = {
    LOW: 'text-yellow-500',
    MEDIUM: 'text-blue-500',
    HIGH: 'text-green-500',
  }

  return (
    <div className="text-xs">
      <span className={confidenceColors[prediction.confidence]}>
        {prediction.confidence} confidence
      </span>
      {prediction.timeframe && (
        <div className="text-[10px] text-[var(--color-text-muted)] leading-tight mt-0.5">
          {prediction.timeframe}
        </div>
      )}
      <div className="text-[var(--color-text-subtle)]">
        Min: {prediction.predictedMinApy.toFixed(2)}%
        {prediction.predictedMaxApy !== undefined && prediction.predictedMaxApy > prediction.predictedMinApy && (
          <span> · Max: {prediction.predictedMaxApy.toFixed(2)}%</span>
        )}
      </div>
    </div>
  )
}

function fmtSignedPct(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

function deltaColorClass(n: number): string {
  return n >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
}

/**
 * Outlook: DefiLlama ML when present, else heuristic min/max from backend; optional ΔAPY trend lines.
 */
function OutlookCell({ pool }: { pool: Pool }) {
  const d7 = pool.apyTrend7d
  const d30 = pool.apyTrend30d
  const hasDelta = d7 != null || d30 != null
  const ann7 = d7 != null ? annualizeApyDeltaPct(d7, 7) : null
  const ann30 = d30 != null ? annualizeApyDeltaPct(d30, 30) : null

  if (!pool.apyPrediction && !hasDelta) {
    return <span className="text-xs text-[var(--color-text-muted)]">-</span>
  }

  return (
    <div
      className="text-xs space-y-1 max-w-[12rem]"
      title="DefiLlama ML outlook when available; otherwise a heuristic band from APY and 7d/30d ΔAPY."
    >
      {pool.apyPrediction && <PredictionBadge prediction={pool.apyPrediction} />}
      {hasDelta && (
        <div
          className="space-y-0.5 border-t border-[var(--color-border)] pt-1 mt-1"
          title="DefiLlama: % change in pool APY vs prior window. Ann. = linear pace scaled to one year (illustrative)."
        >
          <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">ΔAPY trend</div>
          {d7 != null && (
            <div className="leading-tight">
              <span className={deltaColorClass(d7)}>7d {fmtSignedPct(d7)}</span>
              {ann7 != null && (
                <span className="text-[var(--color-text-muted)]"> · ann. {fmtSignedPct(ann7)}</span>
              )}
            </div>
          )}
          {d30 != null && (
            <div className="leading-tight">
              <span className={deltaColorClass(d30)}>30d {fmtSignedPct(d30)}</span>
              {ann30 != null && (
                <span className="text-[var(--color-text-muted)]"> · ann. {fmtSignedPct(ann30)}</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function PoolDetails({ pool }: { pool: Pool }) {
  const vol = pool.volatilityScore
  const volText = vol !== undefined && vol >= 0.05 ? `${vol.toFixed(1)}%` : '-'
  const volColor = vol !== undefined && vol >= 0.05
    ? vol > 35 ? 'text-red-500' : vol > 20 ? 'text-yellow-500' : 'text-green-500'
    : ''
  const apyVolRatio =
    vol !== undefined && vol > 0.05 && pool.apy > 0.0001
      ? `${(pool.apy / vol).toFixed(1)}x`
      : '—'

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <DetailItem label="Base APY" value={`${pool.apyBase.toFixed(2)}%`} />
        <DetailItem label="Reward APY" value={`${pool.apyReward.toFixed(2)}%`} />
        <DetailItem label="7d Trend" value={pool.apyTrend7d != null ? `${pool.apyTrend7d.toFixed(2)}%` : '-'} />
        <DetailItem label="30d Avg" value={pool.apyMean30d ? `${pool.apyMean30d.toFixed(2)}%` : '-'} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <DetailItem label="Volatility (Annual)" value={volText} valueClass={volColor} />
        <DetailItem label="Risk Score" value={`${pool.riskScore || 50}/100`} />
        <DetailItem label="Sharpe Ratio" value={apyVolRatio} />
        <DetailItem label="TVL" value={`$${(pool.tvlUsd / 1_000_000).toFixed(2)}M`} />
      </div>
      
      <div className="flex flex-wrap gap-4 text-sm">
        {pool.stablecoin && (
          <span className="badge badge-success">Stablecoin</span>
        )}
        {pool.ilRisk === 'no' && (
          <span
            className="badge badge-success cursor-help"
            title="DefiLlama index: low classical IL for this pool type. Multi-asset LPs can still have peg drift, range, or bridge risk."
          >
            {ilRiskNoBadgeLabel(pool)}
          </span>
        )}
        {pool.exposure === 'single' && (
          <span className="badge badge-info">Single Asset</span>
        )}
        {pool.inactive && (
          <span className="badge bg-[var(--color-surface-hover)] text-[var(--color-text-muted)] border border-[var(--color-border)]">Inactive yield</span>
        )}
        {pool.apyOutlier && (
          <span className="badge bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/35">Bizarre / stale APY</span>
        )}
        {pool.underlyingTokens && (
          <span className="text-[var(--color-text-muted)]">
            Tokens: {pool.underlyingTokens.join(', ')}
          </span>
        )}
      </div>

      <div className="pt-2 border-t border-[var(--color-border)]">
        <div className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
          Verify on source
        </div>
        <PoolSourceLinks pool={pool} />
      </div>
    </div>
  )
}

function DetailItem({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div>
      <div className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider">{label}</div>
      <div className={`font-mono text-lg font-medium text-[var(--color-text)] ${valueClass || ''}`}>{value}</div>
    </div>
  )
}

export default Pools
