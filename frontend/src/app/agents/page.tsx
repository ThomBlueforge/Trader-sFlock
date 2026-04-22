'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAgents } from '@/hooks/useAgents'
import { useSignalSocket } from '@/hooks/useSignalSocket'
import { api } from '@/lib/api'
import type { SignalOut, WSEvent } from '@/types'
import AgentGrid from '@/components/agents/AgentGrid'
import Button from '@/components/ui/Button'

export default function AgentsPage() {
  const { agents, loading, refresh } = useAgents()
  const [latestSignals, setLatestSignals] = useState<SignalOut[]>([])
  const [refreshing,  setRefreshing]  = useState(false)
  const [creating,    setCreating]    = useState(false)
  const [presets,     setPresets]     = useState(false)

  // Load initial signals
  useEffect(() => {
    api.agents
      .latest()
      .then((d) => setLatestSignals(d.signals ?? []))
      .catch(() => {})
  }, [])

  // WebSocket signal updates
  const handleWS = useCallback((ev: WSEvent) => {
    if (ev.event === 'signal_update') {
      const sig = ev.data as unknown as SignalOut
      setLatestSignals((prev) => {
        const rest = prev.filter((s) => s.agent_id !== sig.agent_id)
        return [...rest, sig]
      })
    }
    if (ev.event === 'training_complete') {
      refresh()
    }
  }, [refresh])
  useSignalSocket(handleWS)

  const handleActivate = async (id: string) => {
    await api.agents.activate(id)
    refresh()
  }

  const handleDeactivate = async (id: string) => {
    await api.agents.deactivate(id)
    refresh()
  }

  const handleRefreshData = async () => {
    setRefreshing(true)
    try {
      await api.refresh()
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 'var(--space-6)',
        }}
      >
        <div>
          <h2 style={{ margin: 0 }}>Agents</h2>
          <p style={{ margin: '4px 0 0', fontSize: 'var(--text-sm)', color: 'var(--color-muted)' }}>
            {agents.length} agent{agents.length !== 1 ? 's' : ''}{' · '}
            {agents.filter((a) => a.status === 'active').length} active
            {agents.length === 0 && ' — create your first agent in the Lab'}
          </p>
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <Button
            variant="secondary"
            size="sm"
            loading={presets}
            title="Auto-create 5 pre-configured agents covering different timeframes and strategies"
            onClick={async () => {
              setPresets(true)
              try { await api.presets(); await refresh() } finally { setPresets(false) }
            }}
          >
            ✨ Create Presets
          </Button>
          {agents.length === 0 && (
            <Button
              variant="primary"
              size="sm"
              loading={creating}
              onClick={async () => {
                setCreating(true)
                try { await api.baseline(); await refresh() } finally { setCreating(false) }
              }}
            >
              ⚡ Quick Start
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            loading={refreshing}
            onClick={handleRefreshData}
          >
            Refresh Data
          </Button>
          <Button variant="primary" size="sm" onClick={() => (window.location.href = '/lab')}>
            + New Agent
          </Button>
        </div>
      </div>

      {loading ? (
        <div
          className="agent-grid"
          style={{ opacity: 0.5 }}
        >
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="card animate-pulse"
              style={{ height: 200 }}
            />
          ))}
        </div>
      ) : (
        <AgentGrid
          agents={agents}
          latestSignals={latestSignals}
          onActivate={handleActivate}
          onDeactivate={handleDeactivate}
          onRefresh={refresh}
        />
      )}
    </div>
  )
}
