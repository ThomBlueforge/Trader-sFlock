'use client'

import { useCallback, useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { Portfolio, Trade } from '@/types'

interface EquityPoint {
  ts: number
  equity: number
}

export function usePortfolio(agentId: string) {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null)
  const [trades, setTrades] = useState<Trade[]>([])
  const [equity, setEquity] = useState<EquityPoint[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!agentId) return
    setLoading(true)
    setError(null)
    try {
      const [p, t, e] = await Promise.all([
        api.portfolio.get(agentId),
        api.portfolio.trades(agentId),
        api.portfolio.equity(agentId),
      ])
      setPortfolio(p)
      setTrades(t)
      setEquity(e)
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [agentId])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { portfolio, trades, equity, loading, error, refresh }
}
