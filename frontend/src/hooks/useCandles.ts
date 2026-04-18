'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { Candle } from '@/types'

export function useCandles(symbol: string, timeframe: string, limit = 500) {
  const [candles, setCandles] = useState<Candle[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    api
      .candles(symbol, timeframe, limit)
      .then((res) => {
        if (!cancelled) setCandles(res.candles ?? [])
      })
      .catch((err) => {
        if (!cancelled) setError(String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [symbol, timeframe, limit])

  return { candles, loading, error }
}
