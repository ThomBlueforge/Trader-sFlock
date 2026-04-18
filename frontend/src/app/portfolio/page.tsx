'use client'

import { useEffect, useState } from 'react'
import { useAgents } from '@/hooks/useAgents'
import { usePortfolio } from '@/hooks/usePortfolio'
import EquityCurve from '@/components/portfolio/EquityCurve'
import TradeLog from '@/components/portfolio/TradeLog'
import AgentComparison from '@/components/portfolio/AgentComparison'
import Button from '@/components/ui/Button'
import { fmtPrice, fmtPct } from '@/lib/formatters'
import { api } from '@/lib/api'
import type { Agent } from '@/types'

export default function PortfolioPage() {
  const { agents } = useAgents()
  const activeAgents = agents.filter((a) => a.status === 'active')

  const [selected, setSelected] = useState<Agent | null>(null)
  const agentId = selected?.id ?? ''

  const { portfolio, trades, equity, loading, refresh } = usePortfolio(agentId)

  // Auto-select first active agent
  useEffect(() => {
    if (!selected && activeAgents.length > 0) {
      setSelected(activeAgents[0])
    }
  }, [activeAgents.length])

  // Re-select when fresh data arrives
  useEffect(() => {
    if (selected) {
      const fresh = agents.find((a) => a.id === selected.id)
      if (fresh) setSelected(fresh)
    }
  }, [agents])

  const handleReset = async () => {
    if (!agentId) return
    await api.portfolio.reset(agentId)
    refresh()
  }

  return (
    <div>
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <h2 style={{ margin: 0 }}>Portfolio</h2>
        <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--color-muted)', marginTop: 'var(--space-1)' }}>
          Paper-trading performance for active agents.
        </p>
      </div>

      {activeAgents.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 'var(--space-16)', color: 'var(--color-muted)' }}>
          <p>No active agents yet.</p>
          <p style={{ marginTop: 'var(--space-2)', fontSize: 'var(--text-sm)' }}>
            <a href="/lab">Train an agent in the Lab</a> then{' '}
            <a href="/agents">activate it on the Agents page</a>.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
          {/* Agent tabs */}
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            {activeAgents.map((a) => (
              <button
                key={a.id}
                className={`btn btn--sm ${selected?.id === a.id ? 'btn--primary' : 'btn--ghost'}`}
                style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}
                onClick={() => setSelected(a)}
              >
                <span
                  style={{ width: 8, height: 8, borderRadius: '50%', background: a.color, flexShrink: 0 }}
                />
                {a.name}
              </button>
            ))}
          </div>

          {selected && (
            <>
              {/* Stats row */}
              {portfolio && (
                <div className="card">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
                    <h3 style={{ margin: 0 }}>{selected.name}</h3>
                    <Button variant="ghost" size="sm" onClick={handleReset}>
                      Reset Portfolio
                    </Button>
                  </div>
                  <div className="stat-grid">
                    <div className="stat-box">
                      <div className="stat-label">Capital</div>
                      <div className="stat-value">${fmtPrice(portfolio.current_capital)}</div>
                    </div>
                    <div className="stat-box">
                      <div className="stat-label">Total Return</div>
                      <div
                        className="stat-value"
                        style={{ color: portfolio.total_return_pct >= 0 ? 'var(--color-bull)' : 'var(--color-bear)' }}
                      >
                        {fmtPct(portfolio.total_return_pct)}
                      </div>
                    </div>
                    <div className="stat-box">
                      <div className="stat-label">Open P&L</div>
                      <div
                        className="stat-value"
                        style={{ color: portfolio.open_pnl >= 0 ? 'var(--color-bull)' : 'var(--color-bear)' }}
                      >
                        {portfolio.open_pnl >= 0 ? '+' : ''}{fmtPrice(portfolio.open_pnl)}
                      </div>
                    </div>
                    <div className="stat-box">
                      <div className="stat-label">Position</div>
                      <div
                        className="stat-value"
                        style={{
                          color:
                            portfolio.position > 0
                              ? 'var(--color-bull)'
                              : portfolio.position < 0
                              ? 'var(--color-bear)'
                              : 'var(--color-muted)',
                        }}
                      >
                        {portfolio.position > 0 ? 'LONG' : portfolio.position < 0 ? 'SHORT' : 'FLAT'}
                      </div>
                    </div>
                    <div className="stat-box">
                      <div className="stat-label">Trades</div>
                      <div className="stat-value">{trades.length}</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Equity curve */}
              <div className="card">
                <h3 style={{ margin: '0 0 var(--space-4)' }}>Equity Curve</h3>
                {loading ? (
                  <div style={{ height: 200, background: 'var(--color-surface-2)', borderRadius: 'var(--radius-md)' }} className="animate-pulse" />
                ) : (
                  <EquityCurve equity={equity} color={selected.color} height={240} />
                )}
              </div>

              {/* Trade log */}
              <div className="card">
                <h3 style={{ margin: '0 0 var(--space-4)' }}>Trade Log</h3>
                <TradeLog trades={trades} />
              </div>
            </>
          )}

          {/* Multi-agent comparison */}
          {activeAgents.length > 1 && (
            <div className="card">
              <h3 style={{ margin: '0 0 var(--space-4)' }}>Agent Comparison</h3>
              <AgentComparison agents={activeAgents} height={280} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
