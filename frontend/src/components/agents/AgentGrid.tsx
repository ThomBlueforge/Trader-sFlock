'use client'

import type { Agent, SignalOut } from '@/types'
import AgentCard from './AgentCard'

interface AgentGridProps {
  agents: Agent[]
  latestSignals: SignalOut[]
  onActivate:   (id: string) => Promise<void>
  onDeactivate: (id: string) => Promise<void>
  onRefresh?:   () => void
}

export default function AgentGrid({
  agents,
  latestSignals,
  onActivate,
  onDeactivate,
  onRefresh,
}: AgentGridProps) {
  if (agents.length === 0) {
    return (
      <div
        style={{
          textAlign: 'center',
          padding: 'var(--space-16)',
          color: 'var(--color-muted)',
          fontSize: 'var(--text-sm)',
        }}
      >
        No agents yet.{' '}
        <a href="/lab" style={{ color: 'var(--color-gold)' }}>
          Create one in the Lab →
        </a>
      </div>
    )
  }

  const signalMap: Record<string, SignalOut> = {}
  latestSignals.forEach((s) => {
    signalMap[s.agent_id] = s
  })

  return (
    <div className="agent-grid">
      {agents.map((agent) => (
        <AgentCard
          key={agent.id}
          agent={agent}
          latestSignal={signalMap[agent.id]}
          onActivate={onActivate}
          onDeactivate={onDeactivate}
          onRefresh={onRefresh}
        />
      ))}
    </div>
  )
}
