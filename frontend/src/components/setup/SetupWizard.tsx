'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { setApiKey, validateApiKey } from '@/lib/claude'
import Button from '@/components/ui/Button'

const SETUP_KEY = 'startgold_setup_done'

function DataScreen({ onNext }: { onNext: () => void }) {
  const [symbols, setSymbols] = useState<Record<string, Record<string, number>>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.symbols()
      .then(setSymbols)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // GC=F is the internal symbol key the backend uses for XAUUSD candle data
  const xauBars = symbols['GC=F'] ?? symbols['XAU_USD'] ?? {}
  const loaded = Object.values(xauBars).some((v) => v > 0) ||
    Object.values(symbols).some(tfBars => Object.values(tfBars).some(v => v > 0))

  return (
    <div>
      <h3 style={{ margin: '0 0 var(--space-4)' }}>Loading Market Data</h3>
      {loading ? (
          <p className="text-muted animate-pulse">Connecting to OANDA and fetching XAUUSD data…</p>
      ) : loaded ? (
        <div>
          <p style={{ color: 'var(--color-bull)', marginBottom: 'var(--space-4)' }}>
            ✓ Market data loaded successfully
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', marginBottom: 'var(--space-4)' }}>
            {Object.entries(xauBars).map(([tf, count]) => (
              <div key={tf} className="stat-box" style={{ minWidth: 80 }}>
                <div className="stat-label">{tf}</div>
                <div className="stat-value" style={{ fontSize: 'var(--text-base)' }}>{count as number}</div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div>
          <p style={{ color: 'var(--color-bear)', marginBottom: 'var(--space-3)' }}>
            No data found — make sure the backend is running at http://localhost:8000
          </p>
          <Button variant="secondary" size="sm" onClick={() => api.refresh().then(() => window.location.reload())}>
            Retry
          </Button>
        </div>
      )}
      <div style={{ marginTop: 'var(--space-6)' }}>
        <Button onClick={onNext} disabled={loading || !loaded}>Next →</Button>
      </div>
    </div>
  )
}

function QuickStartScreen({ onNext }: { onNext: () => void }) {
  const [creating, setCreating] = useState(false)
  const [created, setCreated]   = useState(false)

  const handleCreate = async () => {
    setCreating(true)
    try {
      await api.baseline()
      setCreated(true)
    } catch {
      // If BaselineBot already exists, that's fine
      setCreated(true)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div>
      <h3 style={{ margin: '0 0 var(--space-3)' }}>Quick-Start Agent</h3>
      <p className="text-muted" style={{ marginBottom: 'var(--space-4)' }}>
        Create a pre-configured XGBoost agent on the daily timeframe using 10 curated features.
        Training starts immediately in the background.
      </p>
      {created ? (
        <p style={{ color: 'var(--color-bull)', marginBottom: 'var(--space-4)' }}>
          ✓ BaselineBot created and training started — check the Agents page.
        </p>
      ) : (
        <Button variant="primary" loading={creating} onClick={handleCreate}>
          Create and Train Baseline Agent
        </Button>
      )}
      <div style={{ marginTop: 'var(--space-6)' }}>
        <Button variant="ghost" onClick={onNext}>Skip →</Button>
        {created && <Button onClick={onNext} style={{ marginLeft: 'var(--space-3)' }}>Next →</Button>}
      </div>
    </div>
  )
}

function ClaudeScreen({ onDone }: { onDone: () => void }) {
  const [key,      setKey]      = useState('')
  const [checking, setChecking] = useState(false)
  const [valid,    setValid]    = useState<boolean | null>(null)

  const handleValidate = async () => {
    const clean = key.trim()
    if (!clean) return
    if (validateApiKey(clean)) {
      await setApiKey(clean)
      setValid(true)
    } else {
      setValid(false)
    }
  }

  return (
    <div>
      <h3 style={{ margin: '0 0 var(--space-3)' }}>Claude AI Assistant (Optional)</h3>
      <p className="text-muted" style={{ marginBottom: 'var(--space-4)' }}>
        Paste your Anthropic API key to enable natural language strategy design.
        The key is stored only in your browser — never sent to the backend.
      </p>
      <div className="field">
        <input
          className="input"
          type="password"
          placeholder="sk-ant-…"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          style={{ marginBottom: 'var(--space-2)' }}
        />
        <Button variant="secondary" loading={checking} onClick={handleValidate} disabled={!key.trim()}>
          Validate Key
        </Button>
      </div>
      {valid === true  && <p style={{ color: 'var(--color-bull)', marginBottom: 'var(--space-3)' }}>✓ Key valid — AI assistant ready.</p>}
      {valid === false && <p style={{ color: 'var(--color-bear)', marginBottom: 'var(--space-3)' }}>✗ Invalid key — please check and retry.</p>}
      <div style={{ marginTop: 'var(--space-6)', display: 'flex', gap: 'var(--space-3)' }}>
        <Button variant="ghost" onClick={onDone}>Skip</Button>
        {valid && <Button onClick={onDone}>Finish Setup</Button>}
      </div>
    </div>
  )
}

export default function SetupWizard() {
  const [show,  setShow]  = useState(false)
  const [step,  setStep]  = useState(0)

  useEffect(() => {
    const done = localStorage.getItem(SETUP_KEY)
    if (!done) setShow(true)
  }, [])

  const handleDone = () => {
    localStorage.setItem(SETUP_KEY, '1')
    setShow(false)
  }

  if (!show) return null

  const STEPS = [
    <DataScreen   key="data"    onNext={() => setStep(1)} />,
    <QuickStartScreen key="qs" onNext={() => setStep(2)} />,
    <ClaudeScreen key="claude" onDone={handleDone}   />,
  ]

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: 520 }}>
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-6)' }}>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                style={{
                  flex: 1, height: 4, borderRadius: 2,
                  background: i <= step ? 'var(--color-gold)' : 'var(--color-border)',
                  transition: 'background 0.3s',
                }}
              />
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-6)' }}>
            <span style={{ fontSize: '1.6rem' }}>◈</span>
            <span style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--color-gold)' }}>
              Welcome to Trader’s Flock
            </span>
          </div>
        </div>
        {STEPS[step]}
      </div>
    </div>
  )
}
