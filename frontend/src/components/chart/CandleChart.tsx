'use client'

import { useEffect, useRef } from 'react'
import type { Candle, SignalOut, Agent } from '@/types'

const TF_MAP: Record<string, string> = {
  '5m':  '5',
  '15m': '15',
  '30m': '30',
  '1h':  '60',
  '2h':  '120',
  '4h':  '240',
  '1d':  'D',
}

interface CandleChartProps {
  candles?: Candle[]
  agents?: Agent[]
  signals?: SignalOut[]
  height?: number
  timeframe?: string
}

export default function CandleChart({
  agents = [],
  signals = [],
  height = 480,
  timeframe = '1d',
}: CandleChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetRef    = useRef<unknown>(null)

  const colorMap: Record<string, string> = {}
  agents.forEach((a) => { colorMap[a.id] = a.color })

  useEffect(() => {
    if (!containerRef.current) return

    // Remove previous widget
    containerRef.current.innerHTML = ''

    const interval = TF_MAP[timeframe] ?? 'D'

    const script = document.createElement('script')
    script.src = 'https://s3.tradingview.com/tv.js'
    script.async = true
    script.onload = () => {
      if (!containerRef.current) return
      // @ts-ignore
      widgetRef.current = new window.TradingView.widget({
        autosize:          true,
        symbol:            'OANDA:XAUUSD',
        interval,
        timezone:          'Etc/UTC',
        theme:             'dark',
        style:             '1',
        locale:            'en',
        toolbar_bg:        '#0e0f14',
        enable_publishing: false,
        hide_side_toolbar: false,
        allow_symbol_change: false,
        container_id:      containerRef.current.id,
      })
    }
    containerRef.current.appendChild(script)

    return () => {
      if (containerRef.current) containerRef.current.innerHTML = ''
    }
  }, [timeframe, height])

  return (
    <div style={{ position: 'relative', width: '100%', height }}>
      <div
        id="tv_chart_container"
        ref={containerRef}
        style={{
          width: '100%',
          height: '100%',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
          border: '1px solid var(--color-border)',
        }}
      />

      {/* Signal badges overlay */}
      {signals.length > 0 && (
        <div style={{
          position: 'absolute',
          top: 12,
          right: 50,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          pointerEvents: 'none',
          zIndex: 10,
        }}>
          {signals.map((sig) => {
            const isBull = sig.signal === 'BULL'
            const color  = colorMap[sig.agent_id] ?? '#d4af37'
            const agent  = agents.find((a) => a.id === sig.agent_id)
            return (
              <div key={sig.agent_id} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: 'rgba(14,15,20,0.82)',
                border: `1px solid ${color}55`,
                borderRadius: 6,
                padding: '4px 8px',
                fontSize: '0.7rem',
                fontWeight: 700,
                backdropFilter: 'blur(4px)',
              }}>
                <span style={{ color, fontSize: '0.65rem' }}>{isBull ? '▲' : '▼'}</span>
                <span style={{ color: 'var(--color-muted)' }}>{agent?.name ?? 'Agent'}</span>
                <span style={{ color: isBull ? '#22c55e' : '#ef4444' }}>
                  {isBull ? 'BUY' : 'SELL'}
                </span>
                <span style={{ color: `${(sig.confidence * 100).toFixed(0)}% >= 70` ? '#d4af37' : 'var(--color-muted)', fontSize: '0.62rem' }}>
                  {(sig.confidence * 100).toFixed(0)}%
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
