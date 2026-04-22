'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAgents }       from '@/hooks/useAgents'
import { useSignalSocket } from '@/hooks/useSignalSocket'
import { api }             from '@/lib/api'
import { fmtRelative }     from '@/lib/formatters'
import type { SignalOut, WSEvent } from '@/types'
import SetupWizard      from '@/components/setup/SetupWizard'
import XAUTicker        from '@/components/dashboard/XAUTicker'
import QuickAccessCard  from '@/components/dashboard/QuickAccessCard'
import SignalsTable     from '@/components/dashboard/SignalsTable'
import AgentsOverview   from '@/components/dashboard/AgentsOverview'

export default function HomePage() {
  const [latestSignals, setLatestSignals] = useState<SignalOut[]>([])
  const [generating,    setGenerating]    = useState(false)
  const [generatedAt,   setGeneratedAt]   = useState<number | null>(null)
  const initiated = useRef(false)

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

  // On first load: fetch existing signals, then generate fresh ones
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

  // Live WebSocket: update signals in real-time
  useSignalSocket(useCallback((ev: WSEvent) => {
    if (ev.event === 'signal_update') {
      const sig = ev.data as unknown as SignalOut
      setLatestSignals(prev => [...prev.filter(s => s.agent_id !== sig.agent_id), sig])
    }
  }, []))

  const activeAgents  = agents.filter(a => a.status === 'active')
  const activeAgentIds = new Set(activeAgents.map(a => a.id))

  // Deduplicate: one signal per agent (latest ts), then sort by confidence
  const panelSignals = Array.from(
    latestSignals
      .filter(s => activeAgentIds.has(s.agent_id))
      .reduce((map, s) => {
        const prev = map.get(s.agent_id)
        if (!prev || s.ts > prev.ts) map.set(s.agent_id, s)
        return map
      }, new Map<string, SignalOut>())
      .values()
  ).sort((a, b) => b.confidence - a.confidence)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <SetupWizard />

      {/* ── Row 1: XAUUSD Ticker + Refresh ─────────────────────────────── */}
      <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'stretch' }}>
        <XAUTicker />

        <div style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 'var(--space-2)',
          flexShrink: 0,
        }}>
          <button
            className="btn btn--secondary"
            onClick={refreshSignals}
            disabled={generating}
            title="Recompute signals for all active agents now"
          >
            <span style={{ display: 'inline-block', animation: generating ? 'spin 1s linear infinite' : 'none' }}>↺</span>
            {generating ? 'Generating…' : 'Refresh Signals'}
          </button>
          {generatedAt && !generating && (
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)', textAlign: 'center' }}>
              {fmtRelative(Math.floor(generatedAt / 1000))}
            </span>
          )}
        </div>
      </div>

      {/* ── Row 2: Quick Access Grid ────────────────────────────────────── */}
      <div>
        <p className="dash-section-label">Quick Access</p>
        <div className="quick-grid">
          <QuickAccessCard
            href="/simulate"
            icon="▣"
            label="Simulations"
            description="Monte Carlo runs and historical scenario backtests."
          />
          <QuickAccessCard
            href="/agents"
            icon="◎"
            label="Active Agents"
            description="Parameters, status, and controls for all agents."
            count={activeAgents.length || null}
            countLabel="active"
          />
          <QuickAccessCard
            href="/intelligence"
            icon="∷"
            label="Patterns"
            description="Detected chart patterns and regime signals."
          />
          <QuickAccessCard
            href="#signals"
            icon="⊳"
            label="Latest Signals"
            description="Most recent BUY/SELL signals from active agents."
            count={panelSignals.length || null}
            countLabel="signals"
          />
        </div>
      </div>

      {/* ── Row 3: Signals Table + Agents Overview ──────────────────────── */}
      <div
        id="signals"
        style={{
          display: 'grid',
          gridTemplateColumns: '55fr 45fr',
          gap: 'var(--space-4)',
          alignItems: 'start',
        }}
      >
        <SignalsTable
          signals={panelSignals}
          agents={agents}
          generating={generating}
          onRefresh={refreshSignals}
        />
        <AgentsOverview
          agents={agents}
          latestSignals={latestSignals}
        />
      </div>
    </div>
  )
}
