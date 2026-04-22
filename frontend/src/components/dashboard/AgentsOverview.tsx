import Link from 'next/link'
import type { Agent, SignalOut } from '@/types'
import { fmtPct } from '@/lib/formatters'

interface AgentsOverviewProps {
  agents: Agent[]
  latestSignals: SignalOut[]
}

function signalFor(agentId: string, signals: SignalOut[]): SignalOut | undefined {
  return signals
    .filter((s) => s.agent_id === agentId)
    .sort((a, b) => b.ts - a.ts)[0]
}

export default function AgentsOverview({ agents, latestSignals }: AgentsOverviewProps) {
  const active  = agents.filter((a) => a.status === 'active')
  const trained = agents.filter((a) => a.status === 'trained')
  const rest    = agents.filter((a) => a.status !== 'active' && a.status !== 'trained')

  const sorted = [...active, ...trained, ...rest]

  return (
    <div className="dash-panel" style={{ height: '100%' }}>
      <div className="dash-panel__header">
        <span className="dash-panel__title">Agents</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)' }}>
            {active.length} active · {agents.length} total
          </span>
          <Link
            href="/agents"
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--color-gold)',
              textDecoration: 'none',
            }}
          >
            Manage →
          </Link>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div
          style={{
            padding: 'var(--space-8) var(--space-6)',
            textAlign: 'center',
            color: 'var(--color-muted)',
            fontSize: 'var(--text-sm)',
          }}
        >
          <Link href="/lab" style={{ color: 'var(--color-gold)' }}>
            Build your first agent →
          </Link>
        </div>
      ) : (
        <div style={{ padding: 'var(--space-2) 0' }}>
          {sorted.map((agent) => {
            const sig = signalFor(agent.id, latestSignals)
            const isBull = sig?.signal === 'BULL'
            const sigLabel = sig ? (isBull ? 'buy' : 'sell') : 'hold'

            const isActive = agent.status === 'active'
            const sharpe = agent.metrics?.sharpe
            const winRate = agent.metrics?.win_rate

            return (
              <div key={agent.id} className="agent-row">
                {/* Status dot */}
                <span
                  className="agent-row__dot"
                  style={{
                    background: agent.color,
                    boxShadow: isActive ? `0 0 6px ${agent.color}` : 'none',
                    opacity: isActive ? 1 : 0.45,
                  }}
                />

                {/* Name */}
                <span className="agent-row__name" title={agent.name}>
                  {agent.name}
                </span>

                {/* Timeframe */}
                <span className="badge badge--tf" style={{ fontSize: '0.6rem', padding: '1px 5px', flexShrink: 0 }}>
                  {agent.timeframe}
                </span>

                {/* Signal chip */}
                {isActive && (
                  <span className={`sig-chip sig-chip--${sigLabel}`} style={{ flexShrink: 0 }}>
                    {sig ? (isBull ? 'BUY' : 'SELL') : 'HOLD'}
                  </span>
                )}

                {/* Status badge for non-active */}
                {!isActive && (
                  <span
                    style={{
                      fontSize: 'var(--text-xs)',
                      color: 'var(--color-muted)',
                      flexShrink: 0,
                    }}
                  >
                    {agent.status}
                  </span>
                )}

                {/* Key metric */}
                {sharpe != null ? (
                  <span className="agent-row__metric" style={{ flexShrink: 0 }}>
                    S: {sharpe.toFixed(2)}
                  </span>
                ) : winRate != null ? (
                  <span className="agent-row__metric" style={{ flexShrink: 0 }}>
                    WR: {fmtPct(winRate, 0, false)}
                  </span>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
