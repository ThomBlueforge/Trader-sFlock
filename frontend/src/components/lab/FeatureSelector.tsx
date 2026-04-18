'use client'

import { useEffect, useState } from 'react'
import type { FeatureMeta } from '@/types'
import { api } from '@/lib/api'

interface FeatureSelectorProps {
  timeframe: string
  selected: string[]
  onChange: (keys: string[]) => void
}

const CATEGORY_ORDER = ['price', 'oscillator', 'trend', 'volatility', 'volume', 'intraday', 'macro', 'calendar']
const CATEGORY_LABELS: Record<string, string> = {
  price: 'Price',
  oscillator: 'Oscillators',
  trend: 'Trend',
  volatility: 'Volatility',
  volume: 'Volume',
  intraday: 'Intraday',
  macro: 'Macro (Daily)',
  calendar: 'Calendar',
}

export default function FeatureSelector({ timeframe, selected, onChange }: FeatureSelectorProps) {
  const [features, setFeatures] = useState<FeatureMeta[]>([])

  useEffect(() => {
    api.features(timeframe).then(setFeatures).catch(() => {})
  }, [timeframe])

  const grouped: Record<string, FeatureMeta[]> = {}
  features.forEach((f) => {
    if (!grouped[f.category]) grouped[f.category] = []
    grouped[f.category].push(f)
  })

  const toggle = (key: string) => {
    if (selected.includes(key)) {
      onChange(selected.filter((k) => k !== key))
    } else {
      onChange([...selected, key])
    }
  }

  const toggleGroup = (cat: string) => {
    const catKeys = (grouped[cat] ?? []).map((f) => f.key)
    const allSelected = catKeys.every((k) => selected.includes(k))
    if (allSelected) {
      onChange(selected.filter((k) => !catKeys.includes(k)))
    } else {
      const toAdd = catKeys.filter((k) => !selected.includes(k))
      onChange([...selected, ...toAdd])
    }
  }

  const selectAll = () => onChange(features.map((f) => f.key))
  const clearAll  = () => onChange([])

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 'var(--space-3)',
        }}
      >
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-muted)' }}>
          {selected.length} / {features.length} selected
        </span>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button className="btn btn--ghost btn--sm" onClick={selectAll}>
            All
          </button>
          <button className="btn btn--ghost btn--sm" onClick={clearAll}>
            None
          </button>
        </div>
      </div>

      {CATEGORY_ORDER.filter((cat) => grouped[cat]?.length).map((cat) => (
        <div key={cat} style={{ marginBottom: 'var(--space-4)' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              marginBottom: 'var(--space-2)',
              cursor: 'pointer',
            }}
            onClick={() => toggleGroup(cat)}
          >
            <span
              style={{
                fontSize: 'var(--text-xs)',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: 'var(--color-gold)',
              }}
            >
              {CATEGORY_LABELS[cat] ?? cat}
            </span>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)' }}>
              ({grouped[cat].filter((f) => selected.includes(f.key)).length}/{grouped[cat].length})
            </span>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: 'var(--space-1)',
            }}
          >
            {grouped[cat].map((f, fi) => {
              // Put tooltip on the left for the rightmost column items
              const colCount = 3
              const colIndex = fi % colCount
              const flipLeft = colIndex === colCount - 1
              return (
                <div key={f.key} className="feature-wrap">
                  <label className="checkbox-item">
                    <input
                      type="checkbox"
                      checked={selected.includes(f.key)}
                      onChange={() => toggle(f.key)}
                    />
                    <span style={{ fontSize: 'var(--text-sm)', color: selected.includes(f.key) ? 'var(--color-text)' : 'var(--color-muted)' }}>
                      {f.name}
                    </span>
                    <span style={{ fontSize: '0.6rem', color: 'var(--color-gold-dim)', marginLeft: 'auto', flexShrink: 0 }}>&#9432;</span>
                  </label>
                  <div className={`feature-tooltip${flipLeft ? ' feature-tooltip--left' : ''}`}>
                    <div className="feature-tooltip__name">{f.name}</div>
                    <div className="feature-tooltip__desc">{f.description}</div>
                    <div className="feature-tooltip__key">{f.key}</div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
