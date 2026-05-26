import { useState, useEffect } from 'react'
import { 
  useSystemStatus,
  useSystemStats 
} from '../hooks/useApi'
import { 
  Bell,
  Shield,
  Database,
  Activity,
  Check,
  AlertTriangle,
  RefreshCw,
  Percent,
} from 'lucide-react'
import {
  LS_MAX_APY,
  loadApyCeiling,
  saveApyCeiling,
  loadIncludeOutliers,
  saveIncludeOutliers,
} from '../lib/poolFilters'

function Settings() {
  const { data: status } = useSystemStatus()
  const { data: stats } = useSystemStats()
  const [apyCeiling, setApyCeiling] = useState(() => loadApyCeiling(1000))
  const [includeApyOutliers, setIncludeApyOutliers] = useState(() => loadIncludeOutliers())

  useEffect(() => {
    const def = status?.pools?.maxReasonableApyPercentDefault
    if (def != null && !localStorage.getItem(LS_MAX_APY)) {
      setApyCeiling(def)
    }
  }, [status])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-[var(--color-text)]">Settings</h2>
        <p className="text-[var(--color-text-muted)] mt-1">
          Configure system preferences and view status
        </p>
      </div>

      {/* Status Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* System Status */}
        <div className="card">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-[var(--color-primary)]/10 rounded-lg">
              <Activity className="w-5 h-5 text-[var(--color-primary)]" />
            </div>
            <h3 className="text-lg font-semibold text-[var(--color-text)]">System Status</h3>
          </div>

          <div className="space-y-4">
            <StatusRow 
              label="Environment"
              value={status?.environment || 'unknown'}
              status="neutral"
            />
            <StatusRow 
              label="Trading Mode"
              value={status?.paperTrading ? 'Paper Trading' : 'Live Trading'}
              status={status?.paperTrading ? 'success' : 'warning'}
            />
            <StatusRow 
              label="Scheduler"
              value={status?.scheduler?.isRunning ? 'Running' : 'Stopped'}
              status={status?.scheduler?.isRunning ? 'success' : 'error'}
              detail={`${status?.scheduler?.portfolioJobs || 0} portfolio jobs`}
            />
            <StatusRow 
              label="Telegram"
              value={status?.telegram?.enabled ? 'Configured' : 'Not Configured'}
              status={status?.telegram?.enabled ? 'success' : 'neutral'}
            />
          </div>
        </div>

        {/* Statistics */}
        <div className="card">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-[var(--color-success)]/10 rounded-lg">
              <Database className="w-5 h-5 text-[var(--color-success)]" />
            </div>
            <h3 className="text-lg font-semibold text-[var(--color-text)]">Statistics</h3>
          </div>

          <div className="space-y-4">
            <div className="flex justify-between items-center py-2 border-b border-[var(--color-border)]">
              <span className="text-[var(--color-text-muted)]">Portfolios</span>
              <span className="font-mono font-medium">{stats?.portfolios?.count || 0}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-[var(--color-border)]">
              <span className="text-[var(--color-text-muted)]">Total Value</span>
              <span className="font-mono font-medium">${(stats?.portfolios?.totalValue || 0).toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-[var(--color-border)]">
              <span className="text-[var(--color-text-muted)]">Active Positions</span>
              <span className="font-mono font-medium">{stats?.positions?.total || 0}</span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-[var(--color-text-muted)]">Avg Return</span>
              <span className={`font-mono font-medium ${(stats?.portfolios?.averageReturn || 0) >= 0 ? 'text-positive' : 'text-negative'}`}>
                {(stats?.portfolios?.averageReturn || 0) >= 0 ? '+' : ''}
                {(stats?.portfolios?.averageReturn || 0).toFixed(2)}%
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Configuration Sections */}
      <div className="space-y-4">
        {/* Telegram Configuration */}
        <div className="card">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-blue-500/10 rounded-lg">
              <Bell className="w-5 h-5 text-blue-500" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-[var(--color-text)]">Telegram Notifications</h3>
              <p className="text-sm text-[var(--color-text-muted)]">
                Configure Telegram bot for real-time alerts
              </p>
            </div>
          </div>

          <div className="p-4 bg-[var(--color-surface-hover)] rounded-lg">
            {status?.telegram?.enabled ? (
              <div className="flex items-center gap-2 text-[var(--color-success)]">
                <Check className="w-5 h-5" />
                <span>Telegram bot is configured and connected</span>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-[var(--color-text-muted)]">
                  <AlertTriangle className="w-5 h-5" />
                  <span>Telegram bot not configured</span>
                </div>
                <p className="text-sm text-[var(--color-text-subtle)] mt-2">
                  To enable Telegram notifications, add the following to your .env file:
                </p>
                <code className="block p-3 bg-black/50 rounded text-sm font-mono text-[var(--color-text)] mt-2">
                  TELEGRAM_BOT_TOKEN=your_bot_token<br/>
                  TELEGRAM_CHAT_ID=your_chat_id
                </code>
              </div>
            )}
          </div>
        </div>

        {/* Pool list — APY sanity */}
        <div className="card">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-emerald-500/10 rounded-lg">
              <Percent className="w-5 h-5 text-emerald-500" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-[var(--color-text)]">Pool list (APY)</h3>
              <p className="text-sm text-[var(--color-text-muted)]">
                Hide absurd reported APY (e.g. closed Morpho vaults). Server default{' '}
                {status?.pools?.maxReasonableApyPercentDefault ?? 1000}% (max override{' '}
                {status?.pools?.maxReasonableApyPercentHardCap ?? 50000}%).
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-xs text-[var(--color-text-muted)] mb-1">Max sane APY (%)</label>
              <input
                type="number"
                min={1}
                max={status?.pools?.maxReasonableApyPercentHardCap ?? 50000}
                className="input w-32"
                value={apyCeiling}
                onChange={(e) => setApyCeiling(Number(e.target.value))}
                onBlur={() => saveApyCeiling(apyCeiling)}
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] cursor-pointer">
              <input
                type="checkbox"
                checked={includeApyOutliers}
                onChange={(e) => {
                  const v = e.target.checked
                  setIncludeApyOutliers(v)
                  saveIncludeOutliers(v)
                }}
                className="rounded border-[var(--color-border)]"
              />
              Show APY outliers in the pool table
            </label>
          </div>
        </div>

        {/* Risk Settings */}
        <div className="card">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-yellow-500/10 rounded-lg">
              <Shield className="w-5 h-5 text-yellow-500" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-[var(--color-text)]">Risk Management</h3>
              <p className="text-sm text-[var(--color-text-muted)]">
                Default risk triggers and thresholds
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <RiskTriggerRow 
              name="TVL Drop"
              threshold="30%"
              action="Exit Position"
              cooldown="60 min"
            />
            <RiskTriggerRow 
              name="APY Drop"
              threshold="50%"
              action="Exit Position"
              cooldown="120 min"
            />
            <RiskTriggerRow 
              name="Max Drawdown"
              threshold="15%"
              action="Reduce by 50%"
              cooldown="60 min"
            />
            <RiskTriggerRow 
              name="Volatility Spike"
              threshold="3x normal"
              action="Alert Only"
              cooldown="30 min"
            />
          </div>
        </div>

        {/* Scheduler Settings */}
        <div className="card">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-purple-500/10 rounded-lg">
              <RefreshCw className="w-5 h-5 text-purple-500" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-[var(--color-text)]">Scheduler</h3>
              <p className="text-sm text-[var(--color-text-muted)]">
                Automated task configuration
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex justify-between items-center py-2 border-b border-[var(--color-border)]">
              <span className="text-[var(--color-text-muted)]">Position Updates</span>
              <span className="text-sm">Every 5 minutes</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-[var(--color-border)]">
              <span className="text-[var(--color-text-muted)]">Risk Checks</span>
              <span className="text-sm">Every 60 minutes</span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-[var(--color-text-muted)]">Cache TTL</span>
              <span className="text-sm">5 minutes</span>
            </div>
          </div>
        </div>
      </div>

      {/* Info Footer */}
      <div className="text-center text-sm text-[var(--color-text-muted)]">
        <p>DarkYield v1.0.0 - Configuration changes require server restart</p>
      </div>
    </div>
  )
}

// Components
function StatusRow({ 
  label, 
  value, 
  status, 
  detail 
}: { 
  label: string
  value: string
  status: 'success' | 'warning' | 'error' | 'neutral'
  detail?: string
}) {
  const colors = {
    success: 'text-[var(--color-success)]',
    warning: 'text-[var(--color-warning)]',
    error: 'text-[var(--color-danger)]',
    neutral: 'text-[var(--color-text-muted)]',
  }

  return (
    <div className="flex justify-between items-center py-2 border-b border-[var(--color-border)] last:border-0">
      <div>
        <span className="text-[var(--color-text-muted)]">{label}</span>
        {detail && (
          <p className="text-xs text-[var(--color-text-subtle)]">{detail}</p>
        )}
      </div>
      <span className={`font-medium ${colors[status]}`}>{value}</span>
    </div>
  )
}

function RiskTriggerRow({ 
  name, 
  threshold, 
  action, 
  cooldown 
}: { 
  name: string
  threshold: string
  action: string
  cooldown: string
}) {
  return (
    <div className="flex items-center justify-between p-3 bg-[var(--color-surface-hover)] rounded-lg">
      <div>
        <div className="font-medium text-[var(--color-text)]">{name}</div>
        <div className="text-sm text-[var(--color-text-muted)]">
          Threshold: {threshold} · Action: {action}
        </div>
      </div>
      <div className="text-sm text-[var(--color-text-subtle)]">
        Cooldown: {cooldown}
      </div>
    </div>
  )
}

export default Settings
