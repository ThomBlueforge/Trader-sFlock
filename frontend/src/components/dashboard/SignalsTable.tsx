import type { Agent, SignalOut } from '@/types'
import { fmtConfidence, fmtRelative } from '@/lib/formatters'

interface SignalsTableProps {
  signals: SignalOut[]
  agents: Agent[]
  generating?: boolean
  onRefresh?: () => void
}

function agentName(agentId: string, agents: Agent[]): string {
  return agents.find((a) => a.id === agentId)?.name ?? agentId.slice(0, 8)
}

export default function SignalsTable({
  signals,
  agents,
  generating,
  onRefresh,
}: SignalsTableProps) {
  const rows = [...signals].sort((a, b) => b.ts - a.ts).slice(0, 10)

  return (
    <div className="dash-panel">
      <div className="dash-panel__header">
        <span className="dash-panel__title">Latest Signals</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)' }}>
            {signals.length} signal{signals.length !== 1 ? 's' : ''}
          </span>
          {onRefresh && (
            <button
              className="btn btn--ghost btn--sm"
              onClick={onRefresh}
              disabled={generating}
              title="Refresh signals"
            >
              <span
                style={{
                  display: 'inline-block',
                  animation: generating ? 'spin 1s linear infinite' : 'none',
                }}
              >
                ↺
              </span>
              Refresh
            </button>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <div
          style={{
            padding: 'var(--space-8) var(--space-6)',
            textAlign: 'center',
            color: 'var(--color-muted)',
            fontSize: 'var(--text-sm)',
          }}
        >
          {generating ? 'Generating signals…' : 'No signals yet — activate an agent to start.'}
        </div>
      ) : (
        <table className="table" style={{ margin: 0 }}>
          <thead>
            <tr>
              <th>Time</th>
              <th>Signal</th>
              <th>Agent</th>
              <th>TF</th>
              <th style={{ textAlign: 'right' }}>Confidence</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((sig) => {
              const isBull = sig.signal === 'BULL'
              return (
                <tr key={sig.id}>
                  <td style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-mono), monospace', fontSize: 'var(--text-xs)' }}>
                    {fmtRelative(sig.ts)}
                  </td>
                  <td>
                    <span className={`sig-chip sig-chip--${isBull ? 'buy' : 'sell'}`}>
                      {isBull ? 'BUY' : 'SELL'}
                    </span>
                  </td>
                  <td
                    style={{
                      fontWeight: 500,
                      maxWidth: 160,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {agentName(sig.agent_id, agents)}
                  </td>
                  <td>
                    <span className="badge badge--tf">{sig.timeframe}</span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <span
                      style={{
                        fontFamily: 'var(--font-mono), monospace',
                        fontSize: 'var(--text-xs)',
                        color:
                          sig.confidence >= 0.7
                            ? 'var(--color-bull)'
                            : sig.confidence >= 0.5
                            ? 'var(--color-gold)'
                            : 'var(--color-muted)',
                      }}
                    >
                      {fmtConfidence(sig.confidence)}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
