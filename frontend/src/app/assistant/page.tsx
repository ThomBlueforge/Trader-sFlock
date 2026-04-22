'use client'

import { useState } from 'react'
import type { AgentConfig } from '@/types'
import StrategyChat from '@/components/ai/StrategyChat'
import Button from '@/components/ui/Button'
import Link from 'next/link'

function ConfigPreview({ config }: { config: AgentConfig }) {
  const fields: { label: string; value: string }[] = []
  if (config.name)            fields.push({ label: 'Name',        value: config.name })
  if (config.timeframe)       fields.push({ label: 'Timeframe',   value: config.timeframe })
  if (config.model_type)      fields.push({ label: 'Model',       value: config.model_type })
  if (config.target_horizon)  fields.push({ label: 'Horizon',     value: `${config.target_horizon} bars` })
  if (config.target_threshold)fields.push({ label: 'Threshold',   value: `${(config.target_threshold * 100).toFixed(2)}%` })
  if (config.train_window)    fields.push({ label: 'Train Window',value: `${config.train_window} bars` })
  if (config.position_size_pct) fields.push({ label: 'Position Size', value: `${(config.position_size_pct * 100).toFixed(0)}%` })

  return (
    <div
      style={{
        background: 'oklch(72% 0.14 85 / 0.05)',
        border: '1px solid oklch(72% 0.14 85 / 0.25)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-4)',
      }}
    >
      <div style={{ marginBottom: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-gold)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          ◈ Loaded Strategy
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
        {fields.map((f) => (
          <div key={f.label} className="stat-box" style={{ padding: 'var(--space-2) var(--space-3)' }}>
            <div className="stat-label">{f.label}</div>
            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text)' }}>{f.value}</div>
          </div>
        ))}
      </div>

      {config.features && config.features.length > 0 && (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <div className="stat-label" style={{ marginBottom: 'var(--space-2)' }}>
            Features ({config.features.length})
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-1)' }}>
            {config.features.map((f) => (
              <span key={f} className="badge badge--tf">{f}</span>
            ))}
          </div>
        </div>
      )}

      {config.hyperparams && Object.keys(config.hyperparams).length > 0 && (
        <div>
          <div className="stat-label" style={{ marginBottom: 'var(--space-2)' }}>Hyperparameters</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', fontFamily: 'var(--font-mono), monospace', fontSize: 'var(--text-xs)', color: 'var(--color-muted)' }}>
            {Object.entries(config.hyperparams).map(([k, v]) => (
              <span key={k}>{k}={typeof v === 'number' ? v.toFixed(3) : String(v)}</span>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: 'var(--space-4)' }}>
        <Link href="/lab">
          <Button variant="primary" style={{ width: '100%' }}>
            Open in Lab Builder →
          </Button>
        </Link>
      </div>
    </div>
  )
}

export default function AssistantPage() {
  const [latestConfig, setLatestConfig] = useState<AgentConfig | null>(null)

  return (
    <div>
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <h2 style={{ margin: 0 }}>AI Strategy Assistant</h2>
        <p style={{ margin: '4px 0 0', fontSize: 'var(--text-sm)', color: 'var(--color-muted)' }}>
          Describe a trading idea in plain language. The assistant will suggest the right features, model,
          timeframe, and parameters — then you can open the result directly in the Lab.
        </p>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 380px',
          gap: 'var(--space-4)',
          height: 'calc(100vh - 200px)',
          minHeight: 500,
        }}
      >
        {/* Chat column */}
        <div
          className="card"
          style={{ padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1 }}
        >
          <StrategyChat onConfig={setLatestConfig} />
        </div>

        {/* Preview column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {latestConfig ? (
            <ConfigPreview config={latestConfig} />
          ) : (
            <div
              className="card"
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                color: 'var(--color-muted)',
                gap: 'var(--space-3)',
                flex: 1,
              }}
            >
              <span style={{ fontSize: '2rem', opacity: 0.4 }}>◈</span>
              <p style={{ fontSize: 'var(--text-sm)', maxWidth: 240 }}>
                Ask the assistant to design a strategy. The configuration will appear here.
              </p>
              <div style={{ fontSize: 'var(--text-xs)', borderTop: '1px solid var(--color-border)', paddingTop: 'var(--space-3)', width: '100%', textAlign: 'left' }}>
                <p style={{ marginBottom: 'var(--space-2)' }}>Try asking:</p>
                <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                  <li>• &quot;Build a DXY-correlated daily strategy&quot;</li>
                  <li>• &quot;Design a volatility squeeze breakout on 4h&quot;</li>
                  <li>• &quot;Create a safe-haven flow detector&quot;</li>
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
