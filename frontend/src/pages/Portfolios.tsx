import { useState, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { 
  usePortfolios, 
  useCreatePortfolio,
  useSystemStatus,
  useDeletePortfolio,
} from '../hooks/useApi'
import { 
  Plus, 
  PieChart, 
  TrendingUp, 
  Shield,
  AlertTriangle,
  RefreshCw,
  Clock,
  Check,
  X,
  Layers
} from 'lucide-react'
import { YieldMode, RebalanceFrequency, Portfolio } from '../../../shared/types'

function Portfolios() {
  const { data: portfolios, isLoading } = usePortfolios()
  const { data: systemStatus } = useSystemStatus()
  const location = useLocation()
  const [showCreateModal, setShowCreateModal] = useState(() => 
    location.pathname === '/portfolios/new'
  )
  const [portfolioToDelete, setPortfolioToDelete] = useState<Portfolio | null>(null)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-[var(--color-text)]">Portfolios</h2>
          <p className="text-[var(--color-text-muted)] mt-1">
            Manage your automated yield farming strategies
          </p>
        </div>
        <button 
          onClick={() => setShowCreateModal(true)}
          className="btn-primary"
        >
          <Plus className="w-4 h-4 mr-2" />
          Create Portfolio
        </button>
      </div>

      {/* Status Banner */}
      {systemStatus && (
        <div className="flex flex-wrap gap-4 text-sm">
          <span className="badge badge-info">
            {systemStatus.paperTrading ? 'Paper Trading' : 'Live Trading'}
          </span>
          {systemStatus.scheduler?.isRunning && (
            <span className="badge badge-success">
              <RefreshCw className="w-3 h-3 mr-1 inline animate-spin" />
              Auto-Rebalancing Active
            </span>
          )}
        </div>
      )}

      {/* Portfolios Grid */}
      {isLoading ? (
        <div className="text-center py-12">
          <div className="animate-spin w-8 h-8 border-2 border-[var(--color-primary)] border-t-transparent rounded-full mx-auto" />
        </div>
      ) : portfolios && portfolios.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {portfolios.map((portfolio) => (
            <PortfolioCard
              key={portfolio.id}
              portfolio={portfolio}
              onRequestDelete={() => setPortfolioToDelete(portfolio as Portfolio)}
            />
          ))}
        </div>
      ) : (
        <div className="card text-center py-12">
          <PieChart className="w-12 h-12 text-[var(--color-text-muted)] mx-auto mb-4" />
          <h3 className="text-lg font-medium text-[var(--color-text)] mb-2">
            No Portfolios Yet
          </h3>
          <p className="text-[var(--color-text-muted)] mb-6 max-w-md mx-auto">
            Create your first portfolio to start automated yield optimization. 
            Choose from stablecoins, bluechips, or long-tail strategies.
          </p>
          <button 
            onClick={() => setShowCreateModal(true)}
            className="btn-primary"
          >
            <Plus className="w-4 h-4 mr-2" />
            Create Portfolio
          </button>
        </div>
      )}

      {/* Create Portfolio Modal */}
      {showCreateModal && (
        <CreatePortfolioModal onClose={() => setShowCreateModal(false)} />
      )}

      {portfolioToDelete && (
        <DeletePortfolioModal
          key={portfolioToDelete.id}
          portfolio={portfolioToDelete}
          onClose={() => setPortfolioToDelete(null)}
        />
      )}
    </div>
  )
}

// Portfolio Card Component
function PortfolioCard({
  portfolio,
  onRequestDelete,
}: {
  portfolio: Portfolio
  onRequestDelete: () => void
}) {
  const modeConfig = {
    STABLE_BLUECHIPS: { icon: Layers, color: 'text-indigo-500', bg: 'bg-indigo-500/10' },
    STABLECOINS: { icon: Shield, color: 'text-green-500', bg: 'bg-green-500/10' },
    BLUECHIPS: { icon: TrendingUp, color: 'text-blue-500', bg: 'bg-blue-500/10' },
    LONGTAIL: { icon: AlertTriangle, color: 'text-yellow-500', bg: 'bg-yellow-500/10' },
    MEMECOINS: { icon: AlertTriangle, color: 'text-red-500', bg: 'bg-red-500/10' },
  }

  const config = modeConfig[portfolio.mode]
  const activePositions = portfolio.positions.filter(p => p.status === 'ACTIVE').length
  const isPositive = portfolio.performanceMetrics.totalReturn >= 0

  return (
    <div className="card card-hover flex flex-col">
      <Link to={`/portfolios/${portfolio.id}`} className="block flex-1 p-6 pb-4">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg ${config.bg} flex items-center justify-center`}>
              <config.icon className={`w-5 h-5 ${config.color}`} />
            </div>
            <div>
              <h3 className="font-semibold text-[var(--color-text)]">{portfolio.mode}</h3>
              <p className="text-sm text-[var(--color-text-muted)]">
                {activePositions} active positions
              </p>
            </div>
          </div>
          <span className={`badge ${portfolio.settings.paperTrading ? 'badge-info' : 'badge-warning'}`}>
            {portfolio.settings.paperTrading ? 'Paper' : 'Live'}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <div className="text-xs text-[var(--color-text-muted)] uppercase">Total Value</div>
            <div className="font-mono text-xl font-bold text-[var(--color-text)]">
              ${portfolio.totalValue.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-xs text-[var(--color-text-muted)] uppercase">Return</div>
            <div className={`font-mono text-xl font-bold ${isPositive ? 'text-positive' : 'text-negative'}`}>
              {isPositive ? '+' : ''}{portfolio.performanceMetrics.totalReturn.toFixed(2)}%
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 text-xs text-[var(--color-text-muted)] border-t border-[var(--color-border)] pt-4">
          <span className="flex items-center gap-1">
            <TrendingUp className="w-3 h-3" />
            Realized APY: {portfolio.performanceMetrics.annualizedApy.toFixed(2)}%
          </span>
          <span className="flex items-center gap-1">
            <PieChart className="w-3 h-3" />
            Exp. APY {portfolio.performanceMetrics.expectedApy.toFixed(2)}% · σ {portfolio.performanceMetrics.expectedVolatility.toFixed(1)}% · Sharpe {portfolio.performanceMetrics.expectedSortinoRatio.toFixed(2)}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {portfolio.settings.rebalanceFrequency.toLowerCase().replace('_', ' ')}
          </span>
          <span className="flex items-center gap-1">
            <RefreshCw className="w-3 h-3" />
            {portfolio.performanceMetrics.rebalanceCount} rebalances
          </span>
        </div>
      </Link>
      <div className="border-t border-[var(--color-border)] px-6 py-3 flex justify-end">
        <button
          type="button"
          className="text-xs font-medium text-red-500/90 hover:text-red-500"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onRequestDelete()
          }}
        >
          Delete portfolio
        </button>
      </div>
    </div>
  )
}

function DeletePortfolioModal({
  portfolio,
  onClose,
}: {
  portfolio: Portfolio
  onClose: () => void
}) {
  const [step, setStep] = useState<1 | 2>(1)
  const deletePortfolio = useDeletePortfolio()

  const shortId = portfolio.id.length > 12 ? `${portfolio.id.slice(0, 8)}…` : portfolio.id

  const handleConfirm = async () => {
    await deletePortfolio.mutateAsync(portfolio.id)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50" role="dialog" aria-modal="true" aria-labelledby="delete-portfolio-title">
      <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] max-w-md w-full shadow-xl">
        <div className="p-6 border-b border-[var(--color-border)] flex items-center justify-between">
          <h3 id="delete-portfolio-title" className="text-lg font-bold text-[var(--color-text)]">
            {step === 1 ? 'Delete this portfolio?' : 'Confirm deletion'}
          </h3>
          <button type="button" onClick={onClose} className="p-2 hover:bg-[var(--color-surface-hover)] rounded-lg" aria-label="Close">
            <X className="w-5 h-5 text-[var(--color-text-muted)]" />
          </button>
        </div>
        <div className="p-6 space-y-4">
          {step === 1 ? (
            <>
              <p className="text-sm text-[var(--color-text-muted)]">
                You are about to remove the <span className="text-[var(--color-text)] font-medium">{portfolio.mode}</span> portfolio
                {' '}({shortId}). Positions and history for this portfolio will be deleted from DarkYield.
              </p>
              <p className="text-sm text-[var(--color-text-muted)]">
                Continue only if you intend to delete it.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm text-[var(--color-text-muted)]">
                Last step: permanently delete <span className="text-[var(--color-text)] font-medium">{portfolio.mode}</span>?
                This cannot be undone.
              </p>
            </>
          )}
        </div>
        <div className="p-6 pt-0 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          {step === 1 ? (
            <>
              <button type="button" className="btn-secondary" onClick={onClose}>
                Cancel
              </button>
              <button type="button" className="btn-danger" onClick={() => setStep(2)}>
                Continue
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn-secondary" onClick={() => setStep(1)}>
                Back
              </button>
              <button
                type="button"
                className="btn-danger"
                onClick={handleConfirm}
                disabled={deletePortfolio.isPending}
              >
                {deletePortfolio.isPending ? 'Deleting…' : 'Delete permanently'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// Create Portfolio Modal
function CreatePortfolioModal({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<YieldMode>(YieldMode.STABLE_BLUECHIPS)
  const [capital, setCapital] = useState(10000)
  const [frequency, setFrequency] = useState<RebalanceFrequency>(RebalanceFrequency.DAILY)
  const [concentration, setConcentration] = useState(25)
  const [minTvl, setMinTvl] = useState(1000000)
  const [paperTrading, setPaperTrading] = useState(true)

  // Debug: log mode value to check for undefined issues
  console.log('Current mode:', mode, 'YieldMode keys:', Object.keys(YieldMode))

  const createPortfolio = useCreatePortfolio()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    await createPortfolio.mutateAsync({
      mode,
      initialCapital: capital,
      rebalanceFrequency: frequency,
      paperTrading,
      maxPoolConcentration: concentration,
      minPoolTvl: minTvl,
      apyThreshold: 1,
    })

    onClose()
  }

  const modeInfo: Record<YieldMode, { title: string; description: string; risk: string; color: string; recommended: boolean }> = {
    STABLE_BLUECHIPS: {
      title: 'Stablecoins + Bluechips',
      description: 'Balanced portfolio with USDC/USDT/DAI stablecoins and Top 200 market cap tokens (ETH, WBTC, SOL, etc.). Recommended for most users.',
      risk: 'Low to Moderate',
      color: 'text-indigo-500',
      recommended: true,
    },
    STABLECOINS: {
      title: 'Stablecoins Only',
      description: 'Low-risk USDC, USDT, DAI yields. Conservative approach with minimal volatility.',
      risk: 'Low',
      color: 'text-green-500',
      recommended: false,
    },
    BLUECHIPS: {
      title: 'Bluechip Tokens (Top 200)',
      description: 'Top 200 market cap cryptocurrencies only: ETH, WBTC, SOL, AVAX, major DeFi tokens (AAVE, UNI, LINK, etc.). Established projects with lower risk.',
      risk: 'Moderate',
      color: 'text-blue-500',
      recommended: false,
    },
    LONGTAIL: {
      title: 'Long Tail (Beyond Top 200)',
      description: 'Emerging tokens outside Top 200 market cap. Higher risk/reward from newer protocols, smaller cap DeFi, and experimental projects.',
      risk: 'High',
      color: 'text-yellow-500',
      recommended: false,
    },
    MEMECOINS: {
      title: 'Memecoins',
      description: 'Ultra-high risk strategies for maximum yield. Not recommended for most users.',
      risk: 'Extreme',
      color: 'text-red-500',
      recommended: false,
    },
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-[var(--color-border)] flex items-center justify-between">
          <h3 className="text-xl font-bold text-[var(--color-text)]">Create New Portfolio</h3>
          <button onClick={onClose} className="p-2 hover:bg-[var(--color-surface-hover)] rounded-lg">
            <X className="w-5 h-5 text-[var(--color-text-muted)]" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Mode Selection */}
          <div>
            <label className="block text-sm font-medium text-[var(--color-text)] mb-3">
              Investment Mode
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(Object.keys(YieldMode) as Array<keyof typeof YieldMode>).map((key) => {
                const m = YieldMode[key]
                const info = modeInfo[m]
                if (!info) return null
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={`p-4 rounded-lg border text-left transition-colors ${
                      mode === m 
                        ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10' 
                        : 'border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`font-medium ${info.color}`}>
                        {info.title}
                      </span>
                      {info.recommended && (
                        <span className="badge badge-success text-[10px] px-1.5 py-0.5">
                          Recommended
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-[var(--color-text-muted)] mt-1">
                      Risk: {info.risk}
                    </div>
                  </button>
                )
              })}
            </div>
            <p className="text-sm text-[var(--color-text-muted)] mt-2">
              {modeInfo[mode]?.description || 'Select a portfolio mode'}
            </p>
          </div>

          {/* Capital Input */}
          <div>
            <label className="block text-sm font-medium text-[var(--color-text)] mb-2">
              Initial Capital (USD)
            </label>
            <input
              type="number"
              value={capital}
              onChange={(e) => setCapital(Number(e.target.value))}
              min={1000}
              step={1000}
              className="input"
            />
            <p className="text-xs text-[var(--color-text-muted)] mt-1">
              Minimum $1,000 recommended for effective diversification
            </p>
          </div>

          {/* Rebalance Frequency */}
          <div>
            <label className="block text-sm font-medium text-[var(--color-text)] mb-2">
              Rebalance Frequency
            </label>
            <select
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as RebalanceFrequency)}
              className="select"
            >
              <option value="HOURLY">Every Hour (Aggressive)</option>
              <option value="EVERY_8H">Every 8 Hours</option>
              <option value="EVERY_12H">Every 12 Hours</option>
              <option value="DAILY">Daily (Recommended)</option>
            </select>
          </div>

          {/* Advanced Settings */}
          <div className="space-y-4 border-t border-[var(--color-border)] pt-4">
            <h4 className="font-medium text-[var(--color-text)]">Advanced Settings</h4>
            
            <div>
              <label className="block text-sm text-[var(--color-text-muted)] mb-2">
                Max Pool Concentration: {concentration}%
              </label>
              <input
                type="range"
                min={10}
                max={100}
                value={concentration}
                onChange={(e) => setConcentration(Number(e.target.value))}
                className="w-full"
              />
            </div>

            <div>
              <label className="block text-sm text-[var(--color-text-muted)] mb-2">
                Minimum Pool TVL: ${(minTvl / 1_000_000).toFixed(1)}M
              </label>
              <input
                type="range"
                min={100000}
                max={10000000}
                step={100000}
                value={minTvl}
                onChange={(e) => setMinTvl(Number(e.target.value))}
                className="w-full"
              />
            </div>
          </div>

          {/* Paper Trading Toggle */}
          <div className="flex items-center gap-3 p-4 bg-[var(--color-surface-hover)] rounded-lg">
            <input
              type="checkbox"
              id="paper-trading"
              checked={paperTrading}
              onChange={(e) => setPaperTrading(e.target.checked)}
              className="w-4 h-4 rounded border-[var(--color-border)]"
            />
            <label htmlFor="paper-trading" className="flex-1 cursor-pointer">
              <div className="font-medium text-[var(--color-text)]">Paper Trading Mode</div>
              <div className="text-sm text-[var(--color-text-muted)]">
                Start with simulated funds to test your strategy
              </div>
            </label>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4 border-t border-[var(--color-border)]">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary flex-1"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createPortfolio.isPending}
              className="btn-primary flex-1 disabled:opacity-50"
            >
              {createPortfolio.isPending ? (
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Check className="w-4 h-4 mr-2" />
              )}
              Create Portfolio
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default Portfolios
