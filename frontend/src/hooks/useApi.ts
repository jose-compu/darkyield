import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import type { 
  Pool, 
  Portfolio, 
  RebalancePlan,
  YieldMode,
  RebalanceFrequency,
} from '../../../shared/types'

const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
})

// Error interceptor
api.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('API Error:', error.response?.data || error.message)
    throw error
  }
)

// Pools API
export const usePools = (filters?: Record<string, unknown>) => {
  return useQuery({
    queryKey: ['pools', filters],
    queryFn: async () => {
      const { data } = await api.get('/pools', { params: filters })
      return data.pools as Pool[]
    },
  })
}

export const useStablecoinPools = (minTvl?: number) => {
  return useQuery({
    queryKey: ['pools', 'stablecoins', minTvl],
    queryFn: async () => {
      const { data } = await api.get('/pools/stablecoins', { params: { minTvl } })
      return data.pools as Pool[]
    },
  })
}

export const usePoolDetails = (poolId: string) => {
  return useQuery({
    queryKey: ['pool', poolId],
    queryFn: async () => {
      const { data } = await api.get(`/pools/${poolId}`)
      return data as { pool: Pool; chartData: Array<{ timestamp: Date; apy: number; tvl: number }> }
    },
    enabled: !!poolId,
  })
}

export const useChains = () => {
  return useQuery({
    queryKey: ['chains'],
    queryFn: async () => {
      const { data } = await api.get('/pools/chains')
      return data.chains as Array<{ id: string; name: string; tokenSymbol: string }>
    },
  })
}

// Portfolios API
export const usePortfolios = () => {
  return useQuery({
    queryKey: ['portfolios'],
    queryFn: async () => {
      const { data } = await api.get('/portfolios')
      return data.portfolios as Portfolio[]
    },
  })
}

export const usePortfolio = (id: string) => {
  return useQuery({
    queryKey: ['portfolio', id],
    queryFn: async () => {
      const { data } = await api.get(`/portfolios/${id}`)
      return data as { portfolio: Portfolio; stats: unknown; history: unknown[] }
    },
    enabled: !!id,
  })
}

export const useCreatePortfolio = () => {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async (settings: {
      mode: YieldMode
      initialCapital: number
      rebalanceFrequency: RebalanceFrequency
      paperTrading: boolean
      maxPoolConcentration?: number
      minPoolTvl?: number
      apyThreshold?: number
    }) => {
      const { data } = await api.post('/portfolios', settings)
      return data.portfolio as Portfolio
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolios'] })
    },
  })
}

export const useDeletePortfolio = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (portfolioId: string) => {
      await api.delete(`/portfolios/${portfolioId}`)
    },
    onSuccess: (_, portfolioId) => {
      queryClient.invalidateQueries({ queryKey: ['portfolios'] })
      queryClient.invalidateQueries({ queryKey: ['portfolio', portfolioId] })
    },
  })
}

export const useRebalancePortfolio = () => {
  const queryClient = useQueryClient()
  
  return useMutation({
    mutationFn: async (portfolioId: string) => {
      const { data } = await api.post(`/portfolios/${portfolioId}/rebalance`)
      return data.plan as RebalancePlan | null
    },
    onSuccess: (_, portfolioId) => {
      queryClient.invalidateQueries({ queryKey: ['portfolio', portfolioId] })
      queryClient.invalidateQueries({ queryKey: ['portfolios'] })
    },
  })
}

export const useOptimizePortfolio = () => {
  return useMutation({
    mutationFn: async (portfolioId: string) => {
      const { data } = await api.post(`/portfolios/${portfolioId}/optimize`)
      return data as {
        optimization: {
          allocations: Array<{
            poolId: string
            targetPercentage: number
            currentValue: number
          }>
          expectedReturn: number
          expectedRisk: number
          expectedSortinoRatio: number
          confidence: number
        }
        rebalanceCost: { totalCost: number; gasCost: number; slippageCost: number; trades: number }
        currentMetrics: unknown
      }
    },
  })
}

export const usePortfolioRisk = (portfolioId: string) => {
  return useQuery({
    queryKey: ['portfolio', portfolioId, 'risk'],
    queryFn: async () => {
      const { data } = await api.get(`/portfolios/${portfolioId}/risk`)
      return data.risk as unknown
    },
    enabled: !!portfolioId,
  })
}

// System API
export const useSystemStatus = () => {
  return useQuery({
    queryKey: ['system', 'status'],
    queryFn: async () => {
      const { data } = await api.get('/system/status')
      return data.status as {
        environment: string
        paperTrading: boolean
        scheduler: { isRunning: boolean; portfolioJobs: number }
        telegram: { enabled: boolean; connected: boolean }
        pools?: {
          maxReasonableApyPercentDefault: number
          maxReasonableApyPercentHardCap: number
        }
      }
    },
  })
}

export const useSystemStats = () => {
  return useQuery({
    queryKey: ['system', 'stats'],
    queryFn: async () => {
      const { data } = await api.get('/system/stats')
      return data.stats as {
        portfolios: { count: number; totalValue: number; averageReturn: number }
        positions: { total: number; averagePerPortfolio: number }
      }
    },
  })
}
