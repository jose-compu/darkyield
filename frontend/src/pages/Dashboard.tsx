import { useSystemStats, usePortfolios } from '../hooks/useApi'
import { 
  TrendingUp, 
  Wallet, 
  PieChart, 
  Activity,
  ArrowUpRight,
  ArrowDownRight,
  Zap,
  AlertTriangle
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { RiskLevel } from '../../../shared/types'
import { RiskHelpBubble } from '../components/RiskHelpBubble'

function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useSystemStats()
  const { data: portfolios, isLoading: portfoliosLoading } = usePortfolios()

  const isLoading = statsLoading || portfoliosLoading

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-[var(--color-text)]">Dashboard</h2>
          <p className="text-[var(--color-text-muted)] mt-1">
            Monitor your yield farming performance and opportunities
          </p>
        </div>
        <Link to="/portfolios/new" className="btn-primary">
          <Zap className="w-4 h-4 mr-2" />
          Create Portfolio
        </Link>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Value"
          value={stats?.portfolios?.totalValue || 0}
          format="currency"
          change={stats?.portfolios?.averageReturn}
          icon={Wallet}
          loading={isLoading}
        />
        <StatCard
          title="Active Portfolios"
          value={stats?.portfolios?.count || 0}
          format="number"
          icon={PieChart}
          loading={isLoading}
        />
        <StatCard
          title="Active Positions"
          value={stats?.positions?.total || 0}
          format="number"
          icon={Activity}
          loading={isLoading}
        />
        <StatCard
          title="Avg Return"
          value={stats?.portfolios?.averageReturn || 0}
          format="percent"
          change={stats?.portfolios?.averageReturn}
          icon={TrendingUp}
          loading={isLoading}
        />
      </div>

      {/* Portfolio Overview */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-[var(--color-text)]">
            Active Portfolios
          </h3>
          <Link to="/portfolios" className="text-sm text-[var(--color-primary)] hover:underline">
            View All
          </Link>
        </div>

        {portfolios && portfolios.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Mode</th>
                  <th>Total Value</th>
                  <th>Return</th>
                  <th>Positions</th>
                  <th className="whitespace-nowrap">
                    <RiskHelpBubble>Risk</RiskHelpBubble>
                  </th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {portfolios.map((portfolio) => (
                  <tr key={portfolio.id}>
                    <td>
                      <span className="badge badge-info">
                        {portfolio.mode}
                      </span>
                    </td>
                    <td className="font-mono">
                      ${portfolio.totalValue.toLocaleString()}
                    </td>
                    <td>
                      <span className={portfolio.performanceMetrics.totalReturn >= 0 ? 'text-positive' : 'text-negative'}>
                        {portfolio.performanceMetrics.totalReturn >= 0 ? '+' : ''}
                        {portfolio.performanceMetrics.totalReturn.toFixed(2)}%
                      </span>
                    </td>
                    <td>{portfolio.positions.filter(p => p.status === 'ACTIVE').length}</td>
                    <td>
                      {portfolio.riskSummary ? (
                        <StructuralRiskBadge level={portfolio.riskSummary.level} />
                      ) : (
                        <span className="text-[var(--color-text-muted)]">—</span>
                      )}
                    </td>
                    <td>
                      <Link 
                        to={`/portfolios/${portfolio.id}`}
                        className="text-sm text-[var(--color-primary)] hover:underline"
                      >
                        Manage
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-8">
            <p className="text-[var(--color-text-muted)]">
              No active portfolios. Create one to start yield farming.
            </p>
            <Link to="/portfolios" className="btn-primary mt-4 inline-flex">
              Create Portfolio
            </Link>
          </div>
        )}
      </div>

      {/* Quick Actions & Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="text-lg font-semibold text-[var(--color-text)] mb-4">
            Quick Actions
          </h3>
          <div className="space-y-2">
            <QuickAction 
              title="Browse Yield Pools"
              description="Explore stablecoin, bluechip, and long-tail opportunities"
              href="/pools"
              icon={TrendingUp}
            />
            <QuickAction 
              title="Create New Portfolio"
              description="Set up automated yield optimization strategy"
              href="/portfolios"
              icon={PieChart}
            />
            <QuickAction 
              title="System Settings"
              description="Configure notifications, risk parameters, and API keys"
              href="/settings"
              icon={Activity}
            />
          </div>
        </div>

        <div className="card">
          <h3 className="text-lg font-semibold text-[var(--color-text)] mb-4">
            System Status
          </h3>
          <div className="space-y-3">
            <StatusItem 
              label="Paper Trading Mode"
              value="Active"
              status="success"
              description="Simulated trading with virtual funds"
            />
            <StatusItem 
              label="Risk Monitoring"
              value="Active"
              status="success"
              description="Real-time risk checks every 60 minutes"
            />
            <StatusItem 
              label="Auto-Rebalancing"
              value={portfolios && portfolios.length > 0 ? 'Active' : 'No Portfolios'}
              status={portfolios && portfolios.length > 0 ? 'success' : 'warning'}
            />
            <StatusItem 
              label="Telegram Notifications"
              value="Not Configured"
              status="neutral"
              description="Add TELEGRAM_BOT_TOKEN to .env to enable"
            />
          </div>
        </div>
      </div>
    </div>
  )
}

// Components
interface StatCardProps {
  title: string
  value: number
  format: 'currency' | 'percent' | 'number'
  change?: number
  icon: React.ElementType
  loading?: boolean
}

function StatCard({ title, value, format, change, icon: Icon, loading }: StatCardProps) {
  const formatValue = (val: number) => {
    if (loading) return '-'
    switch (format) {
      case 'currency':
        return `$${val.toLocaleString()}`
      case 'percent':
        return `${val >= 0 ? '+' : ''}${val.toFixed(2)}%`
      default:
        return val.toLocaleString()
    }
  }

  const isPositive = (change || 0) >= 0

  return (
    <div className="stat-card">
      <div className="flex items-center justify-between">
        <span className="stat-label">{title}</span>
        <Icon className="w-5 h-5 text-[var(--color-text-muted)]" />
      </div>
      <span className="stat-value">{formatValue(value)}</span>
      {change !== undefined && (
        <div className={`flex items-center gap-1 stat-change ${isPositive ? 'text-positive' : 'text-negative'}`}>
          {isPositive ? <ArrowUpRight className="w-4 h-4" /> : <ArrowDownRight className="w-4 h-4" />}
          <span>{Math.abs(change).toFixed(2)}%</span>
        </div>
      )}
    </div>
  )
}

const STRUCTURAL_RISK_BADGE: Record<RiskLevel, string> = {
  [RiskLevel.LOW]: 'risk-low',
  [RiskLevel.MODERATE]: 'risk-moderate',
  [RiskLevel.HIGH]: 'risk-high',
  [RiskLevel.EXTREME]: 'risk-extreme',
}

/** Structural risk (same engine as portfolio detail / GET …/risk). */
function StructuralRiskBadge({ level }: { level: RiskLevel }) {
  const className = STRUCTURAL_RISK_BADGE[level] ?? 'risk-moderate'
  const warn = level === RiskLevel.HIGH || level === RiskLevel.EXTREME
  return (
    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${className}`}>
      {warn && <AlertTriangle className="w-3 h-3 mr-1" />}
      {level}
    </span>
  )
}

interface QuickActionProps {
  title: string
  description: string
  href: string
  icon: React.ElementType
}

function QuickAction({ title, description, href, icon: Icon }: QuickActionProps) {
  return (
    <Link 
      to={href}
      className="flex items-start gap-3 p-3 rounded-lg hover:bg-[var(--color-surface-hover)] transition-colors group"
    >
      <div className="w-10 h-10 rounded-lg bg-[var(--color-primary)]/10 flex items-center justify-center group-hover:bg-[var(--color-primary)]/20 transition-colors">
        <Icon className="w-5 h-5 text-[var(--color-primary)]" />
      </div>
      <div>
        <h4 className="font-medium text-[var(--color-text)]">{title}</h4>
        <p className="text-sm text-[var(--color-text-muted)]">{description}</p>
      </div>
    </Link>
  )
}

interface StatusItemProps {
  label: string
  value: string
  status: 'success' | 'warning' | 'error' | 'neutral'
  description?: string
}

function StatusItem({ label, value, status, description }: StatusItemProps) {
  const colors = {
    success: 'bg-[var(--color-success)]',
    warning: 'bg-[var(--color-warning)]',
    error: 'bg-[var(--color-danger)]',
    neutral: 'bg-[var(--color-text-muted)]',
  }

  return (
    <div className="flex items-start gap-3">
      <span className={`w-2 h-2 rounded-full mt-2 ${colors[status]}`} />
      <div className="flex-1">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-[var(--color-text)]">{label}</span>
          <span className="text-sm text-[var(--color-text-muted)]">{value}</span>
        </div>
        {description && (
          <p className="text-xs text-[var(--color-text-subtle)] mt-0.5">{description}</p>
        )}
      </div>
    </div>
  )
}

export default Dashboard
