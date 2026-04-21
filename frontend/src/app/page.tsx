'use client'

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useCandles }      from '@/hooks/useCandles'
import { useAgents }       from '@/hooks/useAgents'
import { useSignalSocket } from '@/hooks/useSignalSocket'
import { api }             from '@/lib/api'
import { fmtConfidence, fmtRelative } from '@/lib/formatters'
import type { SignalOut, WSEvent }    from '@/types'
import SetupWizard from '@/components/setup/SetupWizard'

const CandleChart = dynamic(() => import('@/components/chart/CandleChart'), { ssr: false })

const TIMEFRAMES    = ['5m', '15m', '30m', '1h', '2h', '4h', '1d']
const SIGNAL_COLOR  = { BULL: 'var(--color-bull)', SHORT: 'var(--color-bear)' }

export default function HomePage() {
  const [timeframe,     setTimeframe]     = useState('1d')
  const [latestSignals, setLatestSignals] = useState<SignalOut[]>([])
  const [generating,    setGenerating]    = useState(false)
  const [generatedAt,   setGeneratedAt]   = useState<number | null>(null)
  const initiated = useRef(false)

  const { candles, loading: candlesLoading } = useCandles('GC=F', timeframe)
  const { agents } = useAgents()

  const fetchSignals = useCallback(async () => {
    try {
      const d = await api.agents.latest()
      setLatestSignals(d.signals ?? [])
    } catch {}
  }, [])

  const refreshSignals = useCallback(async () => {
    setGenerating(true)
    try {
      await api.agents.generateSignals()
      await fetchSignals()
      setGeneratedAt(Date.now())
    } catch {}
    finally { setGenerating(false) }
  }, [fetchSignals])

  // On first load: fetch existing signals then immediately regenerate fresh ones
  useEffect(() => {
    if (initiated.current) return
    initiated.current = true
    fetchSignals().then(() => refreshSignals())
  }, []) // eslint-disable-line

  // Auto-refresh every 5 minutes
  useEffect(() => {
    const id = setInterval(refreshSignals, 5 * 60 * 1000)
    return () => clearInterval(id)
  }, [refreshSignals])

  // Live WebSocket updates
  useSignalSocket(useCallback((ev: WSEvent) => {
    if (ev.event === 'signal_update') {
      const sig = ev.data as unknown as SignalOut
      setLatestSignals(prev => [...prev.filter(s => s.agent_id !== sig.agent_id), sig])
    }
  }, []))

  const activeAgents   = agents.filter(a => a.status === 'active')

  // Only signals from currently active agents — one per agent (latest ts)
  const activeAgentIds = new Set(activeAgents.map(a => a.id))
  const activeSignals = Array.from(
    latestSignals
      .filter(s => activeAgentIds.has(s.agent_id))
      .reduce((map, s) => {
        const prev = map.get(s.agent_id)
        if (!prev || s.ts > prev.ts) map.set(s.agent_id, s)
        return map
      }, new Map<string, SignalOut>())
      .values()
  )

  // Chart markers: active-agent signals matching current timeframe
  const chartSignals = activeSignals.filter(s => s.timeframe === timeframe)
  // Panel: active-agent signals sorted by confidence
  const panelSignals = [...activeSignals].sort((a, b) => b.confidence - a.confidence)
  const noSignalYet  = activeAgents.filter(a => !activeSignals.find(s => s.agent_id === a.id))

  const currentPrice = candles.length > 0 ? candles[candles.length - 1].close : null

  return (
    <div>
      <SetupWizard />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', marginBottom: 'var(--space-4)', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)' }}>
          <span style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color: 'var(--color-gold)' }}>XAUUSD</span>
          {currentPrice != null && (
            <span style={{ fontSize: 'var(--text-xl)', fontFamily: 'var(--font-mono), monospace' }}>
              ${currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-1)', flexWrap: 'wrap' }}>
          {TIMEFRAMES.map(tf => (
            <button key={tf} className={`btn btn--sm ${timeframe === tf ? 'btn--primary' : 'btn--ghost'}`}
              onClick={() => setTimeframe(tf)}>{tf}</button>
          ))}
        </div>

        {/* Refresh signals */}
        <button
          className="btn btn--secondary btn--sm"
          onClick={refreshSignals}
          disabled={generating}
          style={{ marginLeft: 'auto' }}
          title="Recompute signals for all active agents now"
        >
          <span style={{ display: 'inline-block', animation: generating ? 'spin 1s linear infinite' : 'none' }}>↺</span>
          {' '}{generating ? 'Generating…' : 'Refresh Signals'}
          {generatedAt && !generating && (
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)', marginLeft: 4 }}>
              {fmtRelative(Math.floor(generatedAt / 1000))}
            </span>
          )}
        </button>
      </div>

      {/* Main layout */}
      <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'flex-start' }}>

        {/* Chart */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {candlesLoading && candles.length === 0 ? (
            <div style={{ height: 480, background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}
              className="animate-pulse">Loading chart…</div>
          ) : (
            <CandleChart candles={candles} agents={agents} signals={chartSignals} timeframe={timeframe} />
          )}
          {!candlesLoading && candles.length > 0 && chartSignals.length === 0 && panelSignals.length > 0 && (
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)', marginTop: 'var(--space-2)', textAlign: 'center' }}>
              Signal markers only appear on the matching timeframe. Switch to the agent’s timeframe to see arrows on the chart.
            </p>
          )}
        </div>

        {/* Signal panel */}
        <div style={{ width: 268, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>

          {/* Panel header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 'var(--space-1)' }}>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-gold)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Live Signals
            </span>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)' }}>
              {panelSignals.length} / {activeAgents.length} agents
            </span>
          </div>

          {/* No active agents */}
          {activeAgents.length === 0 && (
            <div style={{ padding: 'var(--space-6) var(--space-4)', textAlign: 'center', color: 'var(--color-muted)', fontSize: 'var(--text-sm)',
              background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)' }}>
              <p>No active agents.</p>
              <a href="/agents" style={{ color: 'var(--color-gold)', fontSize: 'var(--text-xs)', marginTop: 'var(--space-2)', display: 'block' }}>
                Activate an agent →
              </a>
            </div>
          )}

          {/* Generate button when agents exist but no signals yet */}
          {activeAgents.length > 0 && panelSignals.length === 0 && (
            <div style={{ padding: 'var(--space-4)', background: 'var(--color-surface)',
              border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)' }}>
              <button className="btn btn--primary btn--sm" onClick={refreshSignals}
                disabled={generating} style={{ width: '100%' }}>
                {generating ? 'Generating…' : '↺ Generate Signals Now'}
              </button>
              <p style={{ marginTop: 'var(--space-2)', fontSize: 'var(--text-xs)', color: 'var(--color-muted)', textAlign: 'center' }}>
                First signal generation for active agents.
              </p>
            </div>
          )}

          {/* One card per active agent */}
          {activeAgents.map(agent => {
            const sig = latestSignals.find(s => s.agent_id === agent.id)
            const activeLabel = sig ? (sig.signal === 'BULL' ? 'BUY' : 'SELL') : 'HOLD'
            const signalColors: Record<'BUY'|'HOLD'|'SELL', string> = {
              BUY:  '#22c55e',
              HOLD: '#d4af37',
              SELL: '#ef4444',
            }
            return (
              <div key={agent.id} style={{
                background: 'var(--color-surface)',
                border: `1px solid ${sig ? agent.color + '55' : 'var(--color-border)'}`,
                borderRadius: 'var(--radius-lg)',
                padding: 'var(--space-3)',
                transition: 'border-color 0.4s',
              }}>
                {/* Agent header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 'var(--space-3)' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: agent.color, flexShrink: 0,
                    boxShadow: sig ? `0 0 6px ${agent.color}` : 'none' }} />
                  <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, flex: 1,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {agent.name}
                  </span>
                  <span className="badge badge--tf" style={{ fontSize: '0.6rem', padding: '1px 4px' }}>
                    {agent.timeframe}
                  </span>
                </div>

                {/* BUY / HOLD / SELL */}
                <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center',
                  padding: 'var(--space-2) 0', borderTop: '1px solid var(--color-border)', borderBottom: '1px solid var(--color-border)' }}>
                  {(['BUY', 'HOLD', 'SELL'] as const).map(label => {
                    const isActive = label === activeLabel
                    const color = signalColors[label]
                    return (
                      <span key={label} style={{
                        fontSize: '0.7rem',
                        fontWeight: 800,
                        letterSpacing: '0.12em',
                        color: isActive ? color : 'var(--color-muted)',
                        textShadow: isActive
                          ? `0 0 8px ${color}, 0 0 20px ${color}88`
                          : 'none',
                        opacity: isActive ? 1 : 0.22,
                        transition: 'all 0.4s',
                      }}>{label}</span>
                    )
                  })}
                </div>

                {/* Timestamp */}
                <div style={{ textAlign: 'center', fontSize: '0.62rem', color: 'var(--color-muted)', marginTop: 'var(--space-2)' }}>
                  {sig
                    ? `Last ${activeLabel} · ${fmtRelative(sig.ts)}`
                    : 'Awaiting signal…'
                  }
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
