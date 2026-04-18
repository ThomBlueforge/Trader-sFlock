'use client'

import { useState } from 'react'
import { useAgents } from '@/hooks/useAgents'
import AgentBuilder from '@/components/lab/AgentBuilder'
import TrainingPanel from '@/components/lab/TrainingPanel'
import SetupTester from '@/components/lab/SetupTester'
import Modal from '@/components/ui/Modal'
import type { Agent } from '@/types'

export default function LabPage() {
  const { agents, refresh } = useAgents()
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null)
  const [labTab,        setLabTab]        = useState<'build' | 'train' | 'setup'>('build')
  const [editOpen,      setEditOpen]      = useState(false)

  const handleCreated = async (agentId: string) => {
    await refresh()
    // Auto-select the newly created agent for training
    const found = agents.find((a) => a.id === agentId)
    if (found) setSelectedAgent(found)
    else {
      // Agent might not be in the list yet; fetch after refresh
      setTimeout(async () => {
        await refresh()
        setSelectedAgent((prev) => prev ?? agents.find((a) => a.id === agentId) ?? null)
      }, 300)
    }
  }

  const handleTrainComplete = () => {
    refresh()
  }

  // Keep selectedAgent in sync with fresh agent data from the list
  const liveAgent = selectedAgent
    ? (agents.find((a) => a.id === selectedAgent.id) ?? selectedAgent)
    : null

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-6)' }}>
        <div>
          <h2 style={{ margin: 0 }}>Lab</h2>
          <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--color-muted)', marginTop: 'var(--space-1)' }}>
            Build, train, and test ML signal agents.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
          {(['build', 'train', 'setup'] as const).map((t) => (
            <button
              key={t}
              className={`btn btn--sm ${labTab === t ? 'btn--primary' : 'btn--ghost'}`}
              onClick={() => setLabTab(t)}
              style={{ textTransform: 'capitalize' }}
            >
              {t === 'build' ? '1. Build' : t === 'train' ? '2. Train' : '3. Setup Test'}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab: Build ─────────────────────────────────────────────────── */}
      {labTab === 'build' && <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(340px, 480px) 1fr',
          gap: 'var(--space-6)',
          alignItems: 'flex-start',
        }}
      >
        {/* Left: builder wizard */}
        <div>
          <AgentBuilder onCreated={handleCreated} />

          {/* Existing agents selector */}
          {agents.length > 0 && (
            <div className="card" style={{ marginTop: 'var(--space-4)' }}>
              <h4 style={{ margin: '0 0 var(--space-3)' }}>Retrain Existing Agent</h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {agents
                  .filter((a) => ['created', 'trained'].includes(a.status))
                  .map((a) => (
                    <button
                      key={a.id}
                      className={`btn btn--sm ${selectedAgent?.id === a.id ? 'btn--primary' : 'btn--ghost'}`}
                      style={{ justifyContent: 'flex-start', gap: 'var(--space-2)' }}
                      onClick={() => setSelectedAgent(a)}
                    >
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background: a.color,
                          flexShrink: 0,
                        }}
                      />
                      {a.name}
                      <span style={{ marginLeft: 'auto', opacity: 0.6, fontSize: 'var(--text-xs)' }}>
                        {a.timeframe} · {a.status}
                      </span>
                    </button>
                  ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: training panel */}
        <div>
          {liveAgent ? (
            <TrainingPanel agent={liveAgent} onComplete={handleTrainComplete} />
          ) : (
            <div
              className="card"
              style={{ textAlign: 'center', padding: 'var(--space-12)', color: 'var(--color-muted)' }}
            >
              <p style={{ fontSize: 'var(--text-sm)' }}>Create or select an agent to train it here.</p>
            </div>
          )}
        </div>
      </div>}

      {/* ── Tab: Train ─────────────────────────────────────────────────── */}
      {labTab === 'train' && (
        <div>
          {/* Agent selector */}
          <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
            <h4 style={{ margin: '0 0 var(--space-3)' }}>Select Agent to Train</h4>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
              {agents.map((a) => (
                <button
                  key={a.id}
                  className={`btn btn--sm ${selectedAgent?.id === a.id ? 'btn--primary' : 'btn--ghost'}`}
                  style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}
                  onClick={() => setSelectedAgent(a)}
                >
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: a.color }} />
                  {a.name}
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)' }}>{a.timeframe}</span>
                </button>
              ))}
              {agents.length === 0 && (
                <p className="text-muted" style={{ fontSize: 'var(--text-sm)' }}>
                  No agents yet. Go to the Build tab to create one.
                </p>
              )}
            </div>
          </div>
          {liveAgent ? (
            <>
              {/* Config summary — current parameters with an Edit button */}
              <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
                  <h4 style={{ margin: 0, fontSize: 'var(--text-sm)' }}>Current Configuration</h4>
                  <button
                    className="btn btn--secondary btn--sm"
                    onClick={() => setEditOpen(true)}
                    title="Change features, model, hyperparams, horizon, threshold, train window"
                  >
                    ✏ Edit Config
                  </button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
                  {[
                    { label: 'Timeframe',    value: liveAgent.timeframe },
                    { label: 'Model',        value: liveAgent.model_type },
                    { label: 'Features',     value: `${liveAgent.features.length} selected` },
                    { label: 'Horizon',      value: `${liveAgent.target_horizon} bars` },
                    { label: 'Threshold',    value: `${(liveAgent.target_threshold * 100).toFixed(2)}%` },
                    { label: 'Train Window', value: `${liveAgent.train_window} bars` },
                    { label: 'Position',     value: `${(liveAgent.position_size_pct * 100).toFixed(0)}%` },
                  ].map(({ label, value }) => (
                    <div key={label} className="stat-box" style={{ padding: 'var(--space-2) var(--space-3)' }}>
                      <div className="stat-label">{label}</div>
                      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text)' }}>{value}</div>
                    </div>
                  ))}
                </div>
                {/* Feature pills */}
                {liveAgent.features.length > 0 && (
                  <div>
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)', marginRight: 'var(--space-2)' }}>Features:</span>
                    <div style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4 }}>
                      {liveAgent.features.map(f => (
                        <span key={f} className="badge badge--tf" style={{ fontSize: '0.6rem' }}>{f}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <TrainingPanel agent={liveAgent} onComplete={handleTrainComplete} />

              {/* Edit modal */}
              {editOpen && (
                <Modal
                  isOpen={editOpen}
                  onClose={() => setEditOpen(false)}
                  title={`Edit: ${liveAgent.name}`}
                  size="xl"
                >
                  <AgentBuilder
                    editAgent={liveAgent}
                    onUpdated={async (id) => {
                      setEditOpen(false)
                      await refresh()
                    }}
                  />
                </Modal>
              )}
            </>
          ) : (
            <div className="card" style={{ textAlign: 'center', padding: 'var(--space-12)', color: 'var(--color-muted)' }}>
              <p style={{ fontSize: 'var(--text-sm)' }}>Select an agent above to train it.</p>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Setup Test ────────────────────────────────────────────── */}
      {labTab === 'setup' && (
        <div>
          {/* Agent selector */}
          <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
            <h4 style={{ margin: '0 0 var(--space-3)' }}>Select Trained Agent</h4>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)', marginBottom: 'var(--space-3)' }}>
              The Setup Tester replays the agent’s signals on historical bars using your SL / TP / hold rules.
              The agent must be trained first.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
              {agents.filter((a) => ['trained', 'active'].includes(a.status)).map((a) => (
                <button
                  key={a.id}
                  className={`btn btn--sm ${selectedAgent?.id === a.id ? 'btn--primary' : 'btn--ghost'}`}
                  style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}
                  onClick={() => setSelectedAgent(a)}
                >
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: a.color }} />
                  {a.name}
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)' }}>{a.timeframe} · {a.status}</span>
                </button>
              ))}
              {agents.filter((a) => ['trained', 'active'].includes(a.status)).length === 0 && (
                <p className="text-muted" style={{ fontSize: 'var(--text-sm)' }}>
                  No trained agents yet. Train an agent in the Train tab first.
                </p>
              )}
            </div>
          </div>

          {liveAgent && ['trained', 'active'].includes(liveAgent.status) ? (
            <div className="card">
              <SetupTester agent={liveAgent} />
            </div>
          ) : liveAgent ? (
            <div className="card" style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--color-muted)' }}>
              <p>Agent must be trained before running setup tests.</p>
            </div>
          ) : (
            <div className="card" style={{ textAlign: 'center', padding: 'var(--space-12)', color: 'var(--color-muted)' }}>
              <p style={{ fontSize: 'var(--text-sm)' }}>Select a trained agent above.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
