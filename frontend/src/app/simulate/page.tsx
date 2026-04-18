'use client'

import { useEffect, useRef, useState } from 'react'
import { useAgents } from '@/hooks/useAgents'
import { api } from '@/lib/api'
import type { MonteCarloResult, Scenario } from '@/types'
import MonteCarloChart from '@/components/simulation/MonteCarloChart'
import SimulateSetupTest from '@/components/simulation/SimulateSetupTest'
import Button from '@/components/ui/Button'
import EquityCurve from '@/components/portfolio/EquityCurve'

export default function SimulatePage() {
  const { agents } = useAgents()
  const [tab, setTab] = useState<'monte_carlo' | 'scenarios' | 'tpsl'>('monte_carlo')
  const [agentId,   setAgentId]   = useState('')
  const [nRuns,     setNRuns]     = useState(1000)
  const [blockSize, setBlockSize] = useState(0)

  const [mcResult,  setMcResult]  = useState<MonteCarloResult | null>(null)
  const [running,   setRunning]   = useState(false)
  const [elapsed,   setElapsed]   = useState(0)   // seconds since run started
  const [error,     setError]     = useState('')
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [scenarios,  setScenarios]  = useState<Scenario[]>([])
  const [scenarioId, setScenarioId] = useState('')
  const [scResult,   setScResult]   = useState<{ equity_curve: { ts: number; equity: number }[]; scenario: { name: string } } | null>(null)
  const [scRunning,  setScRunning]  = useState(false)

  useEffect(() => {
    api.simulate.scenarios().then(setScenarios).catch(() => {})
  }, [])

  const handleMonteCarlo = async () => {
    if (!agentId) return
    setRunning(true)
    setElapsed(0)
    setError('')
    setMcResult(null)
    elapsedRef.current = setInterval(() => setElapsed(s => s + 1), 1000)
    try {
      const result = await api.simulate.monteCarlo({ agent_id: agentId, n_runs: nRuns, block_size: blockSize })
      setMcResult(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
      if (elapsedRef.current) clearInterval(elapsedRef.current)
    }
  }

  const handleScenario = async () => {
    if (!scenarioId || !agentId) return
    setScRunning(true)
    setError('')
    try {
      const result = await api.simulate.scenario(scenarioId, agentId)
      setScResult(result)
    } catch (err) {
      setError(String(err))
    } finally {
      setScRunning(false)
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <h2 style={{ margin: 0 }}>Simulate</h2>
        <p style={{ margin: '4px 0 0', fontSize: 'var(--text-sm)', color: 'var(--color-muted)' }}>
          Stress-test your strategies with Monte Carlo simulation and historical scenario analysis.
        </p>
      </div>

      {/* Tab navigation */}
      <div style={{ display: 'flex', gap: 'var(--space-1)', marginBottom: 'var(--space-6)', borderBottom: '1px solid var(--color-border)', paddingBottom: 'var(--space-2)' }}>
        {([
          { id: 'tpsl',         label: 'TP / SL Analysis' },
          { id: 'monte_carlo',  label: 'Monte Carlo' },
          { id: 'scenarios',    label: 'Historical Scenarios' },
        ] as const).map(({ id, label }) => (
          <button key={id}
            className={`btn btn--sm ${tab === id ? 'btn--primary' : 'btn--ghost'}`}
            onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {/* TP/SL Analysis tab */}
      {tab === 'tpsl' && (
        <SimulateSetupTest
          agents={agents}
          agentId={agentId}
          onAgentChange={setAgentId}
        />
      )}

      {/* Agent selector (shared for Monte Carlo + Scenarios) */}
      <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
        <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="field" style={{ margin: 0 }}>
            <label className="field-label">Agent</label>
            <select className="select" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
              <option value="">Select agent…</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.timeframe})</option>)}
            </select>
          </div>

          {tab === 'monte_carlo' && (
            <>
              <div className="field" style={{ margin: 0 }}>
                <label className="field-label">Runs</label>
                <select className="select" value={nRuns} onChange={(e) => setNRuns(Number(e.target.value))}>
                  {[500, 1000, 2000, 5000].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label className="field-label">Mode</label>
                <select className="select" value={blockSize} onChange={(e) => setBlockSize(Number(e.target.value))}>
                  <option value={0}>PnL Shuffle</option>
                  <option value={5}>Block Bootstrap (5)</option>
                  <option value={10}>Block Bootstrap (10)</option>
                </select>
              </div>
              <Button variant="primary" loading={running} onClick={handleMonteCarlo} disabled={!agentId}>
                Run Monte Carlo
              </Button>
            </>
          )}

          {tab === 'scenarios' && (
            <>
              <div className="field" style={{ margin: 0 }}>
                <label className="field-label">Scenario</label>
                <select className="select" value={scenarioId} onChange={(e) => setScenarioId(e.target.value)}>
                  <option value="">Select scenario…</option>
                  {scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <Button variant="primary" loading={scRunning} onClick={handleScenario} disabled={!agentId || !scenarioId}>
                Run Scenario
              </Button>
            </>
          )}
        </div>

        {/* Loading hint with live elapsed timer */}
        {running && tab === 'monte_carlo' && (() => {
          const selectedAgent = agents.find(a => a.id === agentId)
          const isIntraday = selectedAgent && ['5m','15m','30m','1h','2h'].includes(selectedAgent.timeframe)
          const mins = Math.floor(elapsed / 60)
          const secs = elapsed % 60
          const elapsedStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
          return (
            <div style={{ marginTop: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
              <span style={{
                display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
                background: 'var(--color-gold)', animation: 'pulse 1.2s ease-in-out infinite',
                flexShrink: 0,
              }} />
              <div>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)' }}>
                  Running walk-forward backtest + {nRuns.toLocaleString()} simulations
                  {isIntraday ? ' — intraday agents can take 2–5 minutes' : ' — daily agents take ~30–60s'}
                </span>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-gold)', marginLeft: 8, fontFamily: 'var(--font-mono), monospace' }}>
                  {elapsedStr}
                </span>
              </div>
            </div>
          )
        })()}

        {/* Error — shown prominently */}
        {error && (
          <div style={{
            marginTop: 'var(--space-4)',
            background: 'oklch(60% 0.20 25 / 0.08)',
            border: '1px solid oklch(60% 0.20 25 / 0.3)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-3) var(--space-4)',
          }}>
            <p style={{ color: 'var(--color-bear)', fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 'var(--space-1)' }}>
              Simulation failed
            </p>
            <p style={{ color: 'var(--color-bear)', fontSize: 'var(--text-xs)', opacity: 0.85 }}>
              {error.includes('Not enough closed trades')
                ? error + ' — lower train_window or target_threshold in Lab settings.'
                : error.includes('No data') || error.includes('Insufficient')
                ? 'Not enough historical data for this timeframe. Try a daily (1d) agent or reduce train_window.'
                : error.includes('features') || error.includes('no features')
                ? 'This agent has no features selected. Edit the agent in the Lab first.'
                : error}
            </p>
          </div>
        )}
      </div>

      {/* Monte Carlo results */}
      {tab === 'monte_carlo' && mcResult && (
        <div className="card">
          <h3 style={{ margin: '0 0 var(--space-4)' }}>Monte Carlo — {nRuns} Simulations</h3>
          <MonteCarloChart result={mcResult} height={360} />
        </div>
      )}

      {/* Scenario results */}
      {tab === 'scenarios' && scResult && (
        <div className="card">
          <h3 style={{ margin: '0 0 var(--space-4)' }}>
            {scResult.scenario.name} — Backtest Results
          </h3>
          <EquityCurve
            equity={scResult.equity_curve ?? []}
            height={280}
            color="var(--color-gold)"
          />
        </div>
      )}
    </div>
  )
}
