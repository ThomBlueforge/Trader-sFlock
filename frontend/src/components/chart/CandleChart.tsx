'use client'

import { useEffect, useRef } from 'react'
import type { Candle, SignalOut, Agent } from '@/types'

interface CandleChartProps {
  candles: Candle[]
  agents?: Agent[]
  signals?: SignalOut[]
  height?: number
}

export default function CandleChart({
  candles,
  agents = [],
  signals = [],
  height = 480,
}: CandleChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<ReturnType<typeof import('lightweight-charts')['createChart']> | null>(null)
  const seriesRef = useRef<ReturnType<ReturnType<typeof import('lightweight-charts')['createChart']>['addCandlestickSeries']> | null>(null)

  // Create chart once
  useEffect(() => {
    if (!containerRef.current) return

    const { createChart } = require('lightweight-charts') as typeof import('lightweight-charts')

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height,
      layout: {
        background: { color: '#0e0f14' },
        textColor: '#888880',
      },
      grid: {
        vertLines: { color: '#2a2c37' },
        horzLines: { color: '#2a2c37' },
      },
      crosshair: { mode: 1 },
      rightPriceScale: {
        borderColor: '#2a2c37',
      },
      timeScale: {
        borderColor: '#2a2c37',
        timeVisible: true,
        secondsVisible: false,
      },
    })

    const series = chart.addCandlestickSeries({
      upColor:         '#22c55e',
      downColor:       '#ef4444',
      borderUpColor:   '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor:     '#22c55e',
      wickDownColor:   '#ef4444',
    })

    chartRef.current  = chart
    seriesRef.current = series

    // Resize observer
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width } = entry.contentRect
        chart.applyOptions({ width })
      }
    })
    ro.observe(containerRef.current)

    return () => {
      ro.disconnect()
      chart.remove()
      chartRef.current  = null
      seriesRef.current = null
    }
  }, [height])

  // Update candle data
  useEffect(() => {
    if (!seriesRef.current || candles.length === 0) return

    const data = candles.map((c) => ({
      time: (c.ts / 1000) as unknown as import('lightweight-charts').Time,
      open: c.open,
      high: c.high,
      low:  c.low,
      close: c.close,
    }))

    seriesRef.current.setData(data)
    chartRef.current?.timeScale().fitContent()
  }, [candles])

  // Update signal markers
  useEffect(() => {
    if (!seriesRef.current) return

    // Build a color lookup from agents
    const colorMap: Record<string, string> = {}
    agents.forEach((a) => { colorMap[a.id] = a.color })

    const markers = signals
      .map((sig) => ({
        time: sig.ts as unknown as import('lightweight-charts').Time,
        position: sig.signal === 'BULL' ? ('belowBar' as const) : ('aboveBar' as const),
        color: colorMap[sig.agent_id] ?? '#d4af37',
        shape: sig.signal === 'BULL' ? ('arrowUp' as const) : ('arrowDown' as const),
      }))
      .sort((a, b) => (a.time as number) - (b.time as number))

    seriesRef.current.setMarkers(markers)
  }, [signals, agents])

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height,
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        border: '1px solid var(--color-border)',
      }}
    />
  )
}
