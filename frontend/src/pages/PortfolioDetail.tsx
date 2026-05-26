import { useState, Fragment, type ElementType, type ReactNode } from 'react'
import { useParams, Link } from 'react-router-dom'
import { 
  usePortfolio, 
  useRebalancePortfolio,
  useOptimizePortfolio,
} from '../hooks/useApi'
import {
  RiskLevel,
  type PerformanceMetrics,
  type PortfolioRiskSummary,
  type PortfolioPositionRiskRow,
  type Position,
} from '../../../shared/types'
import { RiskHelpBubble } from '../components/RiskHelpBubble'
import { 
  ArrowLeft, 
  RefreshCw, 
  TrendingUp, 
  TrendingDown,
  AlertTriangle,
  Shield,
  Check,
  X,
  Zap,
  DollarSign,
  Clock,
  Calendar
} from 'lucide-react'
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from 'recharts'

function PortfolioDetail() {
  const { id } = useParams<{ id: string }>()
  const [activeTab, setActiveTab] = useState<'overview' | 'risk' | 'positions' | 'history' | 'optimize'>('overview')
  
  const { data, isLoading, refetch } = usePortfolio(id!)
  const rebalance = useRebalancePortfolio()
  const optimize = useOptimizePortfolio()

  const portfolio = data?.portfolio
  const history = (data?.history || []) as Array<{ timestamp: string | Date; totalValue: number }>

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-2 border-[var(--color-primary)] border-t-transparent rounded-full" />
      </div>
    )
  }

  if (!portfolio) {
    return (
      <div className="text-center py-12">
        <p className="text-[var(--color-text-muted)]">Portfolio not found</p>
        <Link to="/portfolios" className="btn-primary mt-4 inline-flex">
          Back to Portfolios
        </Link>
      </div>
    )
  }

  const activePositions = portfolio.positions.filter(p => p.status === 'ACTIVE')
  const isPositive = portfolio.performanceMetrics.totalReturn >= 0
  const rs = portfolio.riskSummary

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link to="/portfolios" className="p-2 hover:bg-[var(--color-surface-hover)] rounded-lg">
            <ArrowLeft className="w-5 h-5 text-[var(--color-text-muted)]" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-bold text-[var(--color-text)]">
                {portfolio.mode} Portfolio
              </h2>
              <span className={`badge ${portfolio.settings.paperTrading ? 'badge-info' : 'badge-warning'}`}>
                {portfolio.settings.paperTrading ? 'Paper' : 'Live'}
              </span>
            </div>
            <p className="text-sm text-[var(--color-text-muted)]">
              Created {new Date(portfolio.createdAt).toLocaleDateString()}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button 
            onClick={() => refetch()}
            className="btn-secondary"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </button>
          <button 
            onClick={() => rebalance.mutate(portfolio.id)}
            disabled={rebalance.isPending}
            className="btn-primary disabled:opacity-50"
          >
            {rebalance.isPending ? (
              <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Zap className="w-4 h-4 mr-2" />
            )}
            Rebalance Now
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Value"
          value={`$${portfolio.totalValue.toLocaleString()}`}
          subValue={`${portfolio.availableCash > 0 ? `$${portfolio.availableCash.toLocaleString()} cash` : 'Fully Invested'}`}
          icon={DollarSign}
        />
        <StatCard
          label="Total Return"
          value={`${isPositive ? '+' : ''}${portfolio.performanceMetrics.totalReturn.toFixed(2)}%`}
          valueClass={isPositive ? 'text-positive' : 'text-negative'}
          subValue={`Realized APY: ${portfolio.performanceMetrics.annualizedApy.toFixed(2)}% · Exp: ${portfolio.performanceMetrics.expectedApy.toFixed(2)}%`}
          icon={isPositive ? TrendingUp : TrendingDown}
        />
        <StatCard
          label="Active Positions"
          value={activePositions.length.toString()}
          subValue={`${portfolio.positions.length - activePositions.length} closed`}
          icon={Shield}
        />
        <StatCard
          label={
            <RiskHelpBubble>
              <span>Risk</span>
            </RiskHelpBubble>
          }
          value={rs ? rs.score.toFixed(1) : '—'}
          subValue={rs?.level ?? '…'}
          valueClass={
            !rs
              ? ''
              : rs.level === RiskLevel.LOW
                ? 'text-positive'
                : rs.level === RiskLevel.EXTREME
                  ? 'text-negative'
                  : 'text-yellow-500'
          }
          icon={AlertTriangle}
          detail={
            rs?.breakdown?.notes?.length ? (
              <ul className="mt-3 max-h-44 list-disc space-y-1.5 overflow-y-auto border-t border-[var(--color-border)] pt-3 pl-4 text-left text-[10px] font-normal normal-case leading-snug tracking-normal text-[var(--color-text-muted)] sm:text-xs">
                {rs.breakdown.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            ) : undefined
          }
        />
      </div>

      {/* Tabs */}
      <div className="border-b border-[var(--color-border)]">
        <nav className="flex gap-6">
          {(['overview', 'risk', 'positions', 'history', 'optimize'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`py-3 text-sm font-medium border-b-2 transition-colors capitalize ${
                activeTab === tab 
                  ? 'border-[var(--color-primary)] text-[var(--color-primary)]' 
                  : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
              }`}
            >
              {tab}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="min-h-[400px]">
        {activeTab === 'overview' && (
          <OverviewTab 
            portfolio={portfolio} 
            history={history}
            activePositions={activePositions}
          />
        )}
        {activeTab === 'risk' && (
          portfolio.riskSummary ? (
            <RiskDetailTab riskSummary={portfolio.riskSummary} />
          ) : (
            <p className="text-[var(--color-text-muted)]">Risk data not available. Refresh the portfolio.</p>
          )
        )}
        {activeTab === 'positions' && (
          <PositionsTab positions={portfolio.positions} />
        )}
        {activeTab === 'history' && (
          <HistoryTab history={history} />
        )}
        {activeTab === 'optimize' && (
          <OptimizeTab 
            portfolio={portfolio}
            onOptimize={() => optimize.mutate(portfolio.id)}
            optimization={optimize.data}
            isOptimizing={optimize.isPending}
          />
        )}
      </div>
    </div>
  )
}

// Stats Card Component
function StatCard({ 
  label, 
  value, 
  subValue, 
  icon: Icon,
  valueClass = '',
  detail,
}: { 
  label: ReactNode
  value: string
  subValue?: string
  icon: ElementType
  valueClass?: string
  detail?: ReactNode
}) {
  return (
    <div className="card">
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1 text-xs uppercase tracking-wider text-[var(--color-text-muted)]">
            {label}
          </p>
          <p className={`text-2xl font-bold mt-1 ${valueClass || 'text-[var(--color-text)]'}`}>
            {value}
          </p>
          {subValue && (
            <p className="text-sm text-[var(--color-text-muted)] mt-1">{subValue}</p>
          )}
        </div>
        <div className="p-2 bg-[var(--color-surface-hover)] rounded-lg">
          <Icon className="w-5 h-5 text-[var(--color-text-muted)]" />
        </div>
      </div>
      {detail}
    </div>
  )
}

// Overview Tab
function OverviewTab({ 
  portfolio, 
  history,
  activePositions 
}: { 
  portfolio: { totalValue: number; performanceMetrics: PerformanceMetrics }
  history: Array<{ timestamp: string | Date; totalValue: number }>
  activePositions: Array<{ pool: { symbol: string; project: string; apy: number }; amount: number; unrealizedPnl: number }>
}) {
  // Format history data for chart
  const chartData = history.map(h => ({
    date: new Date(h.timestamp).toLocaleDateString(),
    value: h.totalValue,
  }))

  // Allocation data for pie chart
  const allocationData = activePositions.map(p => ({
    name: p.pool.symbol,
    value: p.amount + p.unrealizedPnl,
  }))

  const COLORS = ['#4F46E5', '#22C55E', '#EAB308', '#EF4444', '#8B5CF6']

  return (
    <div className="space-y-6">
      {/* Performance Chart */}
      <div className="card">
        <h3 className="text-lg font-semibold text-[var(--color-text)] mb-4">Performance History</h3>
        {chartData.length > 1 ? (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4F46E5" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#4F46E5" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis 
                  dataKey="date" 
                  stroke="var(--color-text-muted)"
                  fontSize={12}
                />
                <YAxis 
                  stroke="var(--color-text-muted)"
                  fontSize={12}
                  tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '8px',
                  }}
                  formatter={(value: number) => [`$${value.toLocaleString()}`, 'Value']}
                />
                <Area 
                  type="monotone" 
                  dataKey="value" 
                  stroke="#4F46E5" 
                  fillOpacity={1} 
                  fill="url(#colorValue)" 
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-center py-8 text-[var(--color-text-muted)]">
            Not enough history data yet. Data will appear after the first rebalancing cycle.
          </p>
        )}
      </div>

      {/* Metrics: realized vs expected */}
      <div>
        <h3 className="text-sm font-semibold text-[var(--color-text-muted)] uppercase tracking-wide mb-3">
          Realized (portfolio history)
        </h3>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <MetricItem
            label="APY (realized)"
            value={`${portfolio.performanceMetrics.annualizedApy.toFixed(2)}%`}
            valueClassName={portfolio.performanceMetrics.annualizedApy < 0 ? 'text-negative' : undefined}
          />
          <MetricItem label="Volatility" value={`${portfolio.performanceMetrics.volatility.toFixed(2)}%`} />
          <MetricItem label="Max Drawdown" value={`${portfolio.performanceMetrics.maxDrawdown.toFixed(2)}%`} />
          <MetricItem label="Sharpe" value={portfolio.performanceMetrics.sortinoRatio.toFixed(2)} />
          <MetricItem label="Fees Paid" value={`$${portfolio.performanceMetrics.feesPaid.toFixed(2)}`} />
        </div>
      </div>

      <div className="mt-6">
        <h3 className="text-sm font-semibold text-[var(--color-text-muted)] uppercase tracking-wide mb-3">
          Expected (open positions)
        </h3>
        <p className="text-xs text-[var(--color-text-muted)] mb-3">
          Value-weighted current APYs and pool volatility scores; Sharpe uses pool ratios when available, otherwise APY ÷ volatility.
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <MetricItem
            label="Expected APY"
            value={`${portfolio.performanceMetrics.expectedApy.toFixed(2)}%`}
            valueClassName={`font-bold ${apyTierClass(portfolio.performanceMetrics.expectedApy)}`}
          />
          <MetricItem
            label="Expected volatility"
            value={`${portfolio.performanceMetrics.expectedVolatility.toFixed(2)}%`}
          />
          <MetricItem
            label="Expected Sharpe"
            value={portfolio.performanceMetrics.expectedSortinoRatio.toFixed(2)}
          />
        </div>
      </div>

      {/* Allocation */}
      {allocationData.length > 0 && (
        <div className="card">
          <h3 className="text-lg font-semibold text-[var(--color-text)] mb-4">Current Allocation</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={allocationData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {allocationData.map((_entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '8px',
                  }}
                  formatter={(value: number) => [`$${value.toLocaleString()}`, 'Value']}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap justify-center gap-4 mt-4">
            {allocationData.map((item, index) => (
              <div key={item.name} className="flex items-center gap-2">
                <div 
                  className="w-3 h-3 rounded-full" 
                  style={{ backgroundColor: COLORS[index % COLORS.length] }}
                />
                <span className="text-sm text-[var(--color-text-muted)]">{item.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function riskDataSourceLabel(source: PortfolioPositionRiskRow['dataSource']): string {
  if (source === 'live_pool') return 'Live index'
  if (source === 'embedded_snapshot') return 'Embedded snapshot'
  return 'Unavailable'
}

function RiskDetailTab({ riskSummary }: { riskSummary: PortfolioRiskSummary }) {
  const breakdown = riskSummary.breakdown
  const rows = riskSummary.positionRiskRows ?? []

  return (
    <div className="space-y-6">
      {breakdown?.formulaNote && (
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-[var(--color-text)] mb-2">Portfolio score</h3>
          <p className="font-mono text-xs leading-relaxed text-[var(--color-text-muted)]">
            {breakdown.formulaNote}
          </p>
        </div>
      )}

      {breakdown?.notes && breakdown.notes.length > 0 && (
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-[var(--color-text)] mb-2">Portfolio-level factors</h3>
          <ul className="list-disc pl-5 text-sm text-[var(--color-text-muted)] space-y-1">
            {breakdown.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-[var(--color-border)]">
          <h3 className="text-lg font-semibold text-[var(--color-text)]">Per-pool risk (numerical)</h3>
          <p className="mt-2 text-xs text-[var(--color-text-muted)] leading-relaxed">
            <strong className="text-[var(--color-text)]">Base</strong> is the DefiLlama-style pool heuristic (0–100) from TVL, IL, APY volatility, stablecoin discount, outlier flags, etc.{' '}
            <strong className="text-[var(--color-text)]">Triggers</strong> adds +10 when a configured rule fires, and +10 more if the observed value is greater than twice the threshold.{' '}
            <strong className="text-[var(--color-text)]">Sum</strong> is base + trigger points before capping. <strong className="text-[var(--color-text)]">Final</strong> is min(100, sum).
          </p>
        </div>
        {rows.length === 0 ? (
          <p className="p-4 text-[var(--color-text-muted)]">No open positions or no risk rows yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table text-sm">
              <thead>
                <tr>
                  <th>Pool</th>
                  <th className="text-right">Base</th>
                  <th className="text-right">Triggers +</th>
                  <th className="text-right">Sum</th>
                  <th className="text-right">Final</th>
                  <th>Level</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <Fragment key={row.positionId}>
                    <tr>
                      <td>
                        <div className="font-medium text-[var(--color-text)]">{row.symbol}</div>
                        <div className="text-xs text-[var(--color-text-muted)]">
                          {row.project} · {row.chain}
                        </div>
                      </td>
                      <td className="text-right font-mono">{row.poolHeuristicScore.toFixed(1)}</td>
                      <td className="text-right font-mono text-[var(--color-text-muted)]">
                        +{row.triggerContribution.toFixed(1)}
                      </td>
                      <td className="text-right font-mono">{row.sumBeforeCap.toFixed(1)}</td>
                      <td className="text-right font-mono font-semibold text-[var(--color-text)]">
                        {row.score.toFixed(1)}
                        {row.cappedAt100 ? (
                          <span className="ml-1 text-[10px] font-normal text-[var(--color-text-muted)]">
                            cap
                          </span>
                        ) : null}
                      </td>
                      <td className="text-xs">{row.level}</td>
                      <td className="text-xs text-[var(--color-text-muted)] whitespace-nowrap">
                        {riskDataSourceLabel(row.dataSource)}
                      </td>
                    </tr>
                    {row.triggers.length > 0 ? (
                      <tr>
                        <td colSpan={7} className="bg-[var(--color-surface-hover)] p-0 border-t border-[var(--color-border)]">
                          <details className="group">
                            <summary className="cursor-pointer px-4 py-2 text-xs text-[var(--color-primary)] hover:underline">
                              Trigger rows ({row.triggers.length})
                            </summary>
                            <div className="px-4 pb-3">
                              <table className="w-full text-xs border border-[var(--color-border)] rounded-md overflow-hidden">
                                <thead className="bg-[var(--color-surface)]">
                                  <tr className="text-left text-[var(--color-text-muted)]">
                                    <th className="p-2">Rule</th>
                                    <th className="p-2">Threshold</th>
                                    <th className="p-2">Measured</th>
                                    <th className="p-2">+pts</th>
                                    <th className="p-2">Fired</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {row.triggers.map((t, j) => (
                                    <tr key={j} className="border-t border-[var(--color-border)]">
                                      <td className="p-2 font-mono">{t.type}</td>
                                      <td className="p-2 font-mono">{t.threshold}</td>
                                      <td className="p-2 font-mono">{t.measuredValue.toFixed(2)}</td>
                                      <td className="p-2 font-mono">+{t.pointsAdded.toFixed(0)}</td>
                                      <td className="p-2">{t.triggered ? 'yes' : 'no'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              <div className="mt-2 space-y-1 text-[var(--color-text-muted)]">
                                {row.triggers.map(
                                  (t, j) =>
                                    t.message ? (
                                      <p key={j} className="text-xs">
                                        <span className="font-mono text-[var(--color-text)]">{t.type}</span>
                                        : {t.message}
                                      </p>
                                    ) : null
                                )}
                              </div>
                            </div>
                          </details>
                        </td>
                      </tr>
                    ) : null}
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

/** Same APY tier colors as Pools `APYBadge` (yield-low … yield-extreme). */
function apyTierClass(apy: number): string {
  if (apy > 50) return 'yield-extreme'
  if (apy > 20) return 'yield-high'
  if (apy > 10) return 'yield-medium'
  return 'yield-low'
}

/**
 * Per-position forward view aligned with backend `PortfolioService.computeExpectedPositionMetrics`
 * (current APY as expected yield, pool vol heuristic, Sharpe from pool ratio or APY/vol fallback).
 */
function positionExpectedForwardMetrics(position: Position): {
  expectedApy: number
  expectedSortinoRatio: number
} {
  const apy = Number(position.currentApy ?? position.pool?.apy ?? 0)
  const pool = position.pool
  const volRaw = pool.volatilityScore
  const vol =
    volRaw !== undefined && Number.isFinite(volRaw) && volRaw >= 0
      ? Math.min(volRaw, 100)
      : pool.stablecoin
        ? 10
        : Math.min(55, 12 + Math.abs(apy) * 0.4)

  const ps = pool.sortinoRatio
  let expectedSortinoRatio = 0
  if (ps !== undefined && ps > 0 && Number.isFinite(ps)) {
    expectedSortinoRatio = ps
  } else if (vol > 0.05) {
    expectedSortinoRatio = apy / vol
  }

  return {
    expectedApy: apy,
    expectedSortinoRatio: Number.isFinite(expectedSortinoRatio) ? expectedSortinoRatio : 0,
  }
}

function MetricItem({
  label,
  value,
  valueClassName,
}: {
  label: string
  value: string
  valueClassName?: string
}) {
  return (
    <div className="p-4 bg-[var(--color-surface-hover)] rounded-lg">
      <div className="text-xs text-[var(--color-text-muted)] uppercase">{label}</div>
      <div
        className={`font-mono text-lg font-medium mt-1 ${valueClassName ?? 'text-[var(--color-text)]'}`}
      >
        {value}
      </div>
    </div>
  )
}

// Positions Tab
function PositionsTab({ positions }: { positions: Position[] }) {
  const active = positions.filter(p => p.status === 'ACTIVE')
  const closed = positions.filter(p => p.status === 'CLOSED')

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-[var(--color-text)]">
        Active Positions ({active.length})
      </h3>
      
      {active.length === 0 ? (
        <p className="text-[var(--color-text-muted)]">No active positions</p>
      ) : (
        <div className="grid gap-4">
          {active.map((position) => {
            const exp = positionExpectedForwardMetrics(position)
            const sortinoDisplay =
              exp.expectedSortinoRatio > 0 ? exp.expectedSortinoRatio.toFixed(2) : '—'

            return (
            <div key={position.id} className="card">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="font-semibold text-[var(--color-text)]">{position.pool.symbol}</h4>
                    <span className="badge badge-success">Active</span>
                  </div>
                  <p className="text-sm text-[var(--color-text-muted)]">
                    {position.pool.project} on {position.pool.chain}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-mono font-medium text-[var(--color-text)]">
                    ${(position.amount + position.unrealizedPnl).toLocaleString()}
                  </p>
                  <p className={`text-sm ${position.unrealizedPnl >= 0 ? 'text-positive' : 'text-negative'}`}>
                    {position.unrealizedPnl >= 0 ? '+' : ''}${position.unrealizedPnl.toFixed(2)}
                  </p>
                </div>
              </div>
              
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 mt-4 pt-4 border-t border-[var(--color-border)] text-sm">
                <div>
                  <span className="text-[var(--color-text-muted)]">Entry APY:</span>
                  <span className={`ml-2 font-mono font-bold ${apyTierClass(position.entryApy)}`}>
                    {position.entryApy.toFixed(2)}%
                  </span>
                </div>
                <div>
                  <span className="text-[var(--color-text-muted)]">Current APY:</span>
                  <span className={`ml-2 font-mono font-bold ${apyTierClass(position.currentApy)}`}>
                    {position.currentApy.toFixed(2)}%
                  </span>
                </div>
                <div>
                  <span className="text-[var(--color-text-muted)]">Entry Date:</span>
                  <span className="ml-2">{new Date(position.entryTimestamp).toLocaleDateString()}</span>
                </div>
                <div title="Forward expected yield from current pool APY (same basis as portfolio Expected APY).">
                  <span className="text-[var(--color-text-muted)]">Expected APY:</span>
                  <span className={`ml-2 font-mono font-bold ${apyTierClass(exp.expectedApy)}`}>
                    {exp.expectedApy.toFixed(2)}%
                  </span>
                </div>
                <div title="Pool Sharpe when DefiLlama provides it; otherwise APY ÷ volatility heuristic.">
                  <span className="text-[var(--color-text-muted)]">Exp. Sharpe:</span>
                  <span className="ml-2 font-mono font-medium text-[var(--color-text)]">{sortinoDisplay}</span>
                </div>
              </div>
            </div>
            )
          })}
        </div>
      )}

      {closed.length > 0 && (
        <>
          <h3 className="text-lg font-semibold text-[var(--color-text)] mt-8">
            Closed Positions ({closed.length})
          </h3>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Pool</th>
                  <th>Realized PnL</th>
                  <th>Fees</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {closed.slice(0, 5).map((position) => (
                  <tr key={position.id}>
                    <td>
                      <div className="font-medium">{position.pool.symbol}</div>
                      <div className="text-xs text-[var(--color-text-muted)]">{position.pool.project}</div>
                    </td>
                    <td className={`font-mono ${position.realizedPnl >= 0 ? 'text-positive' : 'text-negative'}`}>
                      {position.realizedPnl >= 0 ? '+' : ''}${position.realizedPnl.toFixed(2)}
                    </td>
                    <td className="font-mono">${position.feesPaid.toFixed(2)}</td>
                    <td>
                      <span className="text-xs text-[var(--color-text-muted)]">
                        {position.exitReason || 'Closed'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

// History Tab
function HistoryTab({ history }: { history: Array<{ timestamp: string | Date; totalValue: number; metrics?: { dailyReturn: number } }> }) {
  return (
    <div className="card">
      <h3 className="text-lg font-semibold text-[var(--color-text)] mb-4">Snapshot History</h3>
      
      {history.length === 0 ? (
        <p className="text-[var(--color-text-muted)]">No history available yet</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Total Value</th>
                <th>Daily Return</th>
              </tr>
            </thead>
            <tbody>
              {history.slice().reverse().slice(0, 50).map((snapshot, index) => (
                <tr key={index}>
                  <td>{new Date(snapshot.timestamp).toLocaleString()}</td>
                  <td className="font-mono">${snapshot.totalValue.toLocaleString()}</td>
                  <td className={`font-mono ${(snapshot.metrics?.dailyReturn || 0) >= 0 ? 'text-positive' : 'text-negative'}`}>
                    {(snapshot.metrics?.dailyReturn || 0) >= 0 ? '+' : ''}{(snapshot.metrics?.dailyReturn || 0).toFixed(2)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// Optimize Tab
function OptimizeTab({ 
  portfolio, 
  onOptimize, 
  optimization, 
  isOptimizing 
}: { 
  portfolio: { id: string; totalValue: number; availableCash: number }
  onOptimize: () => void
  optimization?: {
    optimization: {
      allocations: Array<{ 
        poolId: string; 
        targetPercentage: number; 
        currentValue: number;
        recommendedHoldTime?: number;
        deadlineToExit?: string;
        projectedApySeries?: Array<{ day: number; projectedApy: number }>;
        apyDecayRate?: number;
        totalReturnEstimate?: number;
        maxProfitDay?: number;
      }>
      expectedReturn: number
      expectedRisk: number
      expectedSortinoRatio: number
      confidence: number
      poolDecayMetrics?: Array<{
        poolId: string;
        symbol: string;
        apyDecayRate: number;
        optimalHoldTime: number;
        deadlineToExit?: string;
        recommendation: string;
        totalReturnEstimate: number;
      }>;
      overallRecommendation?: string;
      averageHoldTime?: number;
    }
    rebalanceCost: { totalCost: number; trades: number }
  }
  isOptimizing: boolean
}) {
  return (
    <div className="space-y-6">
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-[var(--color-text)]">Portfolio Optimization</h3>
            <p className="text-sm text-[var(--color-text-muted)]">
              Calculate optimal allocation based on current market conditions
            </p>
          </div>
          <button 
            onClick={onOptimize}
            disabled={isOptimizing}
            className="btn-primary disabled:opacity-50"
          >
            {isOptimizing ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                Calculating...
              </>
            ) : (
              <>
                <Zap className="w-4 h-4 mr-2" />
                Run Optimization
              </>
            )}
          </button>
        </div>

        {optimization && (
          <div className="space-y-6">
            {/* Optimization Results */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <MetricItem 
                label="Expected APY" 
                value={`${optimization.optimization.expectedReturn.toFixed(2)}%`} 
              />
              <MetricItem 
                label="Expected Risk" 
                value={`${optimization.optimization.expectedRisk.toFixed(2)}%`} 
              />
              <MetricItem 
                label="Sharpe Ratio" 
                value={optimization.optimization.expectedSortinoRatio.toFixed(2)} 
              />
              <MetricItem 
                label="Confidence" 
                value={`${(optimization.optimization.confidence * 100).toFixed(0)}%`} 
              />
            </div>

            {/* Time-Based Strategy */}
            {(optimization.optimization.overallRecommendation || optimization.optimization.averageHoldTime) && (
              <div className="p-4 bg-indigo-500/10 border border-indigo-500/30 rounded-lg">
                <div className="flex items-start gap-3">
                  <Clock className="w-5 h-5 text-indigo-500 mt-0.5" />
                  <div className="flex-1">
                    <h4 className="font-medium text-[var(--color-text)] mb-1">Time-Based Exit Strategy</h4>
                    {optimization.optimization.averageHoldTime && (
                      <p className="text-sm text-[var(--color-text-muted)] mb-2">
                        Average recommended hold time: <strong>{optimization.optimization.averageHoldTime.toFixed(1)} days</strong>
                      </p>
                    )}
                    {optimization.optimization.overallRecommendation && (
                      <p className="text-sm text-[var(--color-text)]">
                        {optimization.optimization.overallRecommendation}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Rebalance Cost */}
            <div className="p-4 bg-[var(--color-surface-hover)] rounded-lg">
              <h4 className="font-medium text-[var(--color-text)] mb-2">Estimated Rebalance Cost</h4>
              <div className="flex gap-6 text-sm">
                <span>Total: <strong className="font-mono">${optimization.rebalanceCost.totalCost.toFixed(2)}</strong></span>
                <span>Trades: <strong>{optimization.rebalanceCost.trades}</strong></span>
              </div>
            </div>

            {/* Proposed Allocation with Time Recommendations */}
            <div>
              <h4 className="font-medium text-[var(--color-text)] mb-3">Proposed Allocation & Exit Deadlines</h4>
              <div className="overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Pool</th>
                      <th>Target %</th>
                      <th>Target Value</th>
                      <th>Hold Time</th>
                      <th>Exit By</th>
                      <th>Est. Return</th>
                    </tr>
                  </thead>
                  <tbody>
                    {optimization.optimization.allocations.map((alloc) => {
                      const decayMetric = optimization.optimization.poolDecayMetrics?.find(m => m.poolId === alloc.poolId);
                      return (
                        <tr key={alloc.poolId}>
                          <td className="font-mono text-xs">
                            {decayMetric?.symbol || alloc.poolId.slice(0, 20)}...
                          </td>
                          <td className="font-mono">{alloc.targetPercentage.toFixed(2)}%</td>
                          <td className="font-mono">
                            ${((alloc.targetPercentage / 100) * portfolio.totalValue).toFixed(2)}
                          </td>
                          <td className="font-mono">
                            {alloc.recommendedHoldTime ? (
                              <span className={`${alloc.recommendedHoldTime <= 3 ? 'text-red-500' : alloc.recommendedHoldTime <= 7 ? 'text-yellow-500' : 'text-green-500'}`}>
                                {alloc.recommendedHoldTime}d
                              </span>
                            ) : '-'}
                          </td>
                          <td className="font-mono text-xs">
                            {alloc.deadlineToExit ? (
                              <span className="flex items-center gap-1">
                                <Calendar className="w-3 h-3" />
                                {new Date(alloc.deadlineToExit).toLocaleDateString()}
                              </span>
                            ) : '-'}
                          </td>
                          <td className="font-mono text-positive">
                            {alloc.totalReturnEstimate ? `+${alloc.totalReturnEstimate.toFixed(2)}%` : '-'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Pool Decay Recommendations */}
            {optimization.optimization.poolDecayMetrics && optimization.optimization.poolDecayMetrics.length > 0 && (
              <div>
                <h4 className="font-medium text-[var(--color-text)] mb-3">APY Decay Analysis</h4>
                <div className="space-y-2">
                  {optimization.optimization.poolDecayMetrics.slice(0, 5).map((metric) => (
                    <div key={metric.poolId} className="p-3 bg-[var(--color-surface-hover)] rounded-lg text-sm">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-medium">{metric.symbol}</span>
                        <span className={`font-mono ${metric.apyDecayRate < -0.01 ? 'text-red-500' : metric.apyDecayRate > 0.01 ? 'text-green-500' : 'text-[var(--color-text-muted)]'}`}>
                          {metric.apyDecayRate > 0 ? '+' : ''}{(metric.apyDecayRate * 100).toFixed(2)}%/day
                        </span>
                      </div>
                      <p className="text-[var(--color-text-muted)]">{metric.recommendation}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-3 pt-4 border-t border-[var(--color-border)]">
              <button className="btn-primary flex-1">
                <Check className="w-4 h-4 mr-2" />
                Apply Optimization
              </button>
              <button className="btn-secondary">
                <X className="w-4 h-4 mr-2" />
                Dismiss
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default PortfolioDetail
