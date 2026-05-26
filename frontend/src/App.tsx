import { BrowserRouter as Router, Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { 
  LayoutDashboard, 
  PieChart, 
  TrendingUp, 
  Settings, 
  Bell,
  Menu,
  X,
  Moon,
  Sun,
  Zap
} from 'lucide-react'
import { useState, useEffect } from 'react'
import { useThemeStore } from './hooks/useThemeStore'
import Dashboard from './pages/Dashboard'
import Pools from './pages/Pools'
import Portfolios from './pages/Portfolios'
import SettingsPage from './pages/Settings'
import PortfolioDetail from './pages/PortfolioDetail'

function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { isDark, toggleTheme } = useThemeStore()

  // Apply theme class to document
  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [isDark])

  const navigation = [
    { name: 'Dashboard', href: '/', icon: LayoutDashboard },
    { name: 'Yield Pools', href: '/pools', icon: TrendingUp },
    { name: 'Portfolios', href: '/portfolios', icon: PieChart },
    { name: 'Settings', href: '/settings', icon: Settings },
  ]

  return (
    <Router>
      <div className="min-h-screen bg-[var(--color-bg)]">
        {/* Mobile sidebar overlay */}
        {sidebarOpen && (
          <div 
            className="fixed inset-0 bg-black/50 z-40 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar */}
        <aside 
          className={`fixed top-0 left-0 z-50 h-full w-64 bg-[var(--color-surface)] border-r border-[var(--color-border)]
                     transform transition-transform duration-300 ease-in-out lg:translate-x-0
                     ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
        >
          <div className="flex items-center justify-between h-16 px-6 border-b border-[var(--color-border)]">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-[var(--color-primary)] flex items-center justify-center">
                <Zap className="w-5 h-5 text-white" />
              </div>
              <span className="text-xl font-bold text-[var(--color-text)]">DarkYield</span>
            </div>
            <button 
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden p-2 rounded-lg hover:bg-[var(--color-surface-hover)]"
            >
              <X className="w-5 h-5 text-[var(--color-text)]" />
            </button>
          </div>

          <nav className="p-4 space-y-1">
            {navigation.map((item) => (
              <NavLink
                key={item.name}
                to={item.href}
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) => `
                  flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors
                  ${isActive 
                    ? 'bg-[var(--color-primary)]/10 text-[var(--color-primary)]' 
                    : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)]'}
                `}
              >
                <item.icon className="w-5 h-5" />
                {item.name}
              </NavLink>
            ))}
          </nav>

          {/* Status indicator */}
          <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-[var(--color-border)]">
            <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
              <span className="w-2 h-2 rounded-full bg-[var(--color-success)] animate-pulse" />
              <span>System Online</span>
              <span className="ml-auto text-xs">v1.0.0</span>
            </div>
          </div>
        </aside>

        {/* Main content */}
        <div className="lg:ml-64">
          {/* Header */}
          <header className="sticky top-0 z-30 h-16 bg-[var(--color-bg)]/80 backdrop-blur-md border-b border-[var(--color-border)]">
            <div className="flex items-center justify-between h-full px-4 lg:px-8">
              <div className="flex items-center gap-4">
                <button 
                  onClick={() => setSidebarOpen(true)}
                  className="lg:hidden p-2 rounded-lg hover:bg-[var(--color-surface-hover)]"
                >
                  <Menu className="w-5 h-5 text-[var(--color-text)]" />
                </button>
                <h1 className="text-lg font-semibold text-[var(--color-text)]">
                  Yield Optimization Platform
                </h1>
              </div>

              <div className="flex items-center gap-3">
                {/* Theme toggle */}
                <button
                  onClick={toggleTheme}
                  className="p-2 rounded-lg hover:bg-[var(--color-surface-hover)] transition-colors"
                  title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
                >
                  {isDark ? (
                    <Sun className="w-5 h-5 text-[var(--color-text-muted)]" />
                  ) : (
                    <Moon className="w-5 h-5 text-[var(--color-text-muted)]" />
                  )}
                </button>

                {/* Notifications */}
                <button className="p-2 rounded-lg hover:bg-[var(--color-surface-hover)] transition-colors relative">
                  <Bell className="w-5 h-5 text-[var(--color-text-muted)]" />
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[var(--color-danger)]" />
                </button>

                {/* Paper Trading Badge */}
                <span className="hidden sm:inline-flex badge badge-info">
                  Paper Trading
                </span>
              </div>
            </div>
          </header>

          {/* Page content */}
          <main className="p-4 lg:p-8">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/pools" element={<Pools />} />
              <Route path="/portfolios" element={<Portfolios />} />
              <Route path="/portfolios/new" element={<Navigate to="/portfolios" replace />} />
              <Route path="/portfolios/:id" element={<PortfolioDetail />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </main>
        </div>
      </div>
    </Router>
  )
}

export default App
