'use client'

import { useEffect, useRef, useState } from 'react'
import type { AgentConfig } from '@/types'
import { useClaudeAgent, type ChatMessage } from '@/hooks/useClaudeAgent'
import { clearApiKey, getApiKey, setApiKey, validateApiKey } from '@/lib/claude'
import Button from '@/components/ui/Button'

const SUGGESTED_PROMPTS = [
  'Build a mean reversion strategy for gold on 15m',
  'Create a trend-following daily agent using macro signals',
  'Design a volatility breakout strategy on 4h',
  'My Sharpe is 0.3 — how do I improve it?',
  'Add safe-haven features for times of market stress',
]

interface StrategyChatProps {
  onConfig?: (config: AgentConfig) => void
  className?: string
}

function ApiKeySetup({ onSaved }: { onSaved: () => void }) {
  const [key,      setKey]      = useState('')
  const [checking, setChecking] = useState(false)
  const [error,    setError]    = useState('')

  const handleSave = async () => {
    const clean = key.trim()
    if (!clean) return
    if (validateApiKey(clean)) {
      await setApiKey(clean)
      setError('')
      onSaved()
    } else {
      setError('Key must start with sk-ant- and be at least 40 characters. Check you copied the full key.')
    }
  }

  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        height: '100%', gap: 'var(--space-4)',
        padding: 'var(--space-8)',
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: '2rem' }}>🔑</div>
      <h3 style={{ margin: 0 }}>Connect Claude AI</h3>
      <p className="text-muted" style={{ maxWidth: 320 }}>
        Enter your Anthropic API key to enable the AI strategy assistant.
        Stored only in your browser — never sent to any server except Anthropic.
      </p>
      <input
        type="password"
        className="input"
        placeholder="sk-ant-api03-…"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleSave()}
        style={{ maxWidth: 360, textAlign: 'center' }}
      />
      {error && <p style={{ color: 'var(--color-bear)', fontSize: 'var(--text-sm)' }}>{error}</p>}
      <Button onClick={handleSave} loading={checking} disabled={!key.trim()}>
        Connect
      </Button>
      <a
        href="https://console.anthropic.com/account/keys"
        target="_blank"
        rel="noopener noreferrer"
        style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)' }}
      >
        Get an API key →
      </a>
    </div>
  )
}

function ConfigCard({ config, onApply }: { config: AgentConfig; onApply: (c: AgentConfig) => void }) {
  return (
    <div
      style={{
        background: 'oklch(72% 0.14 85 / 0.06)',
        border: '1px solid oklch(72% 0.14 85 / 0.3)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-3)',
        marginTop: 'var(--space-3)',
      }}
    >
      <div
        style={{
          display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', marginBottom: 'var(--space-2)',
        }}
      >
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-gold)', fontWeight: 700 }}>
          ◈ Strategy Config
        </span>
        <Button variant="primary" size="sm" onClick={() => onApply(config)}>
          Apply to Builder
        </Button>
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        {config.name      && <span className="badge badge--tf">{config.name}</span>}
        {config.timeframe && <span className="badge badge--tf">{config.timeframe}</span>}
        {config.model_type && <span className="badge badge--tf">{config.model_type}</span>}
        {config.features  && <span className="badge badge--tf">{config.features.length} features</span>}
      </div>
    </div>
  )
}

function MessageBubble({ msg, onApply }: { msg: ChatMessage; onApply: (c: AgentConfig) => void }) {
  const isUser = msg.role === 'user'
  // Strip config_json blocks from display text
  const displayText = msg.content.replace(/```config_json[\s\S]*?```/g, '').trim()

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        marginBottom: 'var(--space-3)',
      }}
    >
      <div
        style={{
          maxWidth: '85%',
          background: isUser ? 'var(--color-gold)' : 'var(--color-surface-2)',
          color: isUser ? 'oklch(8% 0.01 265)' : 'var(--color-text)',
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--space-3) var(--space-4)',
          fontSize: 'var(--text-sm)',
          lineHeight: 1.6,
          whiteSpace: 'pre-wrap',
        }}
      >
        {displayText || (msg.streaming ? '…' : '')}
        {msg.streaming && (
          <span
            style={{
              display: 'inline-block',
              width: 6, height: 14,
              background: 'currentColor',
              marginLeft: 2,
              animation: 'pulse 1s infinite',
              verticalAlign: 'middle',
            }}
          />
        )}
        {msg.config && <ConfigCard config={msg.config} onApply={onApply} />}
      </div>
    </div>
  )
}

export default function StrategyChat({ onConfig, className = '' }: StrategyChatProps) {
  const [hasKey,  setHasKey]  = useState(false)
  const [input,   setInput]   = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  const { messages, streaming, error, send, clear } = useClaudeAgent(onConfig)

  useEffect(() => {
    setHasKey(!!getApiKey())
  }, [])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSubmit = async () => {
    if (!input.trim() || streaming) return
    const text = input.trim()
    setInput('')
    await send(text)
  }

  const handleDisconnect = () => {
    clearApiKey()
    setHasKey(false)
    clear()
  }

  if (!hasKey) {
    return (
      <div className={className} style={{ height: '100%' }}>
        <ApiKeySetup onSaved={() => setHasKey(true)} />
      </div>
    )
  }

  return (
    <div
      className={className}
      style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex', alignItems: 'center',
          justifyContent: 'space-between',
          padding: 'var(--space-3) var(--space-4)',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-gold)' }}>
          ◈ AI Strategy Assistant
        </span>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <Button variant="ghost" size="sm" onClick={clear}>Clear</Button>
          <Button variant="ghost" size="sm" onClick={handleDisconnect}>Disconnect</Button>
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-4)' }}>
        {messages.length === 0 && (
          <div>
            <p className="text-muted" style={{ fontSize: 'var(--text-sm)', marginBottom: 'var(--space-4)' }}>
              Ask me to design a trading strategy, or try a suggestion:
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {SUGGESTED_PROMPTS.map((p) => (
                <button
                  key={p}
                  className="btn btn--ghost btn--sm"
                  style={{ justifyContent: 'flex-start', textAlign: 'left' }}
                  onClick={() => send(p)}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} onApply={(c) => onConfig?.(c)} />
        ))}
        {error && (
          <p style={{ color: 'var(--color-bear)', fontSize: 'var(--text-xs)', padding: 'var(--space-2)' }}>
            {error}
          </p>
        )}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <div
        style={{
          display: 'flex', gap: 'var(--space-2)',
          padding: 'var(--space-3) var(--space-4)',
          borderTop: '1px solid var(--color-border)',
        }}
      >
        <textarea
          className="input"
          rows={2}
          placeholder="Ask about gold trading strategies…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              handleSubmit()
            }
          }}
          style={{ resize: 'none', flex: 1 }}
          disabled={streaming}
        />
        <Button onClick={handleSubmit} loading={streaming} disabled={!input.trim()}>
          Send
        </Button>
      </div>
    </div>
  )
}
