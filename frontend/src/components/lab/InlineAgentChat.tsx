'use client'

import { useEffect, useRef, useState } from 'react'
import { getApiKey, setApiKey, validateApiKey } from '@/lib/claude'
import { useInlineChat, type InlineChatMsg } from '@/hooks/useInlineChat'
import type { AgentConfig, FeatureMeta } from '@/types'

const STEP_SUGGESTIONS: Record<number, string[]> = {
  0: [
    'Build a safe-haven agent for geopolitical crises',
    'Design a 4h swing trading strategy',
    'Create a daily macro-driven gold agent',
  ],
  1: [
    'Select the best macro features for this timeframe',
    'What features work best for mean reversion?',
    'Give me a momentum-focused feature set',
  ],
  2: [
    'Which model type is best for daily gold?',
    'I want fewer false signals — tune the hyperparams',
    'Suggest XGBoost settings to reduce overfitting',
  ],
  3: [
    'What horizon makes sense for a daily agent?',
    'My threshold is too low, what should I use?',
    'Optimise the train window for current data length',
  ],
}

interface Props {
  step:        number
  form:        Record<string, unknown>
  allFeatures: FeatureMeta[]
  onApply:     (config: AgentConfig) => void
}

function Message({ msg }: { msg: InlineChatMsg }) {
  const isUser = msg.role === 'user'
  const display = msg.content.replace(/```config_json[\s\S]*?```/g, '').trim()
  return (
    <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
      <div style={{
        maxWidth: '88%',
        background:    isUser ? 'var(--color-gold)' : 'var(--color-surface-2)',
        color:         isUser ? '#0e0f14'           : 'var(--color-text)',
        borderRadius:  'var(--radius-md)',
        padding:       '6px 10px',
        fontSize:      'var(--text-xs)',
        lineHeight:    1.55,
        whiteSpace:    'pre-wrap',
      }}>
        {display || (msg.streaming ? '…' : '')}
        {msg.streaming && (
          <span style={{ display: 'inline-block', width: 6, height: 12, background: 'currentColor',
            marginLeft: 2, verticalAlign: 'middle', animation: 'pulse 1s infinite' }} />
        )}
        {msg.config && !msg.streaming && (
          <div style={{ marginTop: 6, padding: '4px 8px',
            background: 'oklch(72% 0.14 85 / 0.15)',
            border: '1px solid oklch(72% 0.14 85 / 0.4)',
            borderRadius: 4, fontSize: '0.65rem', color: 'var(--color-gold)', fontWeight: 700 }}>
            ✓ Config applied to form
          </div>
        )}
      </div>
    </div>
  )
}

export default function InlineAgentChat({ step, form, allFeatures, onApply }: Props) {
  const [open,    setOpen]    = useState(false)
  const [input,   setInput]   = useState('')
  const [hasKey,  setHasKey]  = useState(false)
  const [keyInput,setKeyInput]= useState('')
  const [keyErr,  setKeyErr]  = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  const { messages, streaming, error, send, clear } = useInlineChat(onApply)

  useEffect(() => { setHasKey(!!getApiKey()) }, [open])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const handleSend = async () => {
    if (!input.trim() || streaming) return
    const text = input.trim()
    setInput('')
    await send(text, step, form as unknown as Parameters<typeof send>[2], allFeatures)
  }

  const handleConnectKey = async () => {
    const clean = keyInput.trim()
    if (!clean) return
    if (validateApiKey(clean)) {
      await setApiKey(clean)
      setHasKey(true)
      setKeyErr('')
    } else {
      setKeyErr('Key must start with sk-ant- and be at least 40 characters. Check you copied the full key.')
    }
  }

  const suggestions = STEP_SUGGESTIONS[step] ?? []

  // ── Toggle button ──────────────────────────────────────────────────────────
  if (!open) {
    return (
      <div style={{ marginTop: 'var(--space-4)' }}>
        <button
          onClick={() => setOpen(true)}
          style={{
            display:      'flex',
            alignItems:   'center',
            gap:          6,
            background:   'oklch(72% 0.14 85 / 0.08)',
            border:       '1px dashed oklch(72% 0.14 85 / 0.4)',
            borderRadius: 'var(--radius-md)',
            padding:      '8px 14px',
            cursor:       'pointer',
            width:        '100%',
            color:        'var(--color-gold)',
            fontSize:     'var(--text-xs)',
            fontWeight:   600,
            transition:   'background 150ms',
          }}
        >
          <span style={{ fontSize: '1rem' }}>✨</span>
          Ask AI to help configure this step
          <span style={{ marginLeft: 'auto', opacity: 0.6, fontSize: '0.65rem', fontWeight: 400 }}>
            {hasKey ? 'Claude ready' : 'API key required'}
          </span>
        </button>
      </div>
    )
  }

  // ── Expanded panel ─────────────────────────────────────────────────────────
  return (
    <div style={{
      marginTop:    'var(--space-4)',
      background:   'var(--color-surface)',
      border:       '1px solid oklch(72% 0.14 85 / 0.3)',
      borderRadius: 'var(--radius-lg)',
      overflow:     'hidden',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 12px', borderBottom: '1px solid var(--color-border)',
        background: 'oklch(72% 0.14 85 / 0.06)' }}>
        <span style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--color-gold)' }}>
          ✨ AI Configuration Assistant
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          {messages.length > 0 && (
            <button onClick={clear} style={{ background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--color-muted)', fontSize: 'var(--text-xs)' }}>Clear</button>
          )}
          <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none',
            cursor: 'pointer', color: 'var(--color-muted)', fontSize: 'var(--text-xs)' }}>✕</button>
        </div>
      </div>

      {/* No API key — setup */}
      {!hasKey ? (
        <div style={{ padding: 'var(--space-4)', textAlign: 'center' }}>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)', marginBottom: 'var(--space-3)' }}>
            Enter your Anthropic API key to enable AI assistance.<br />
            <a href="https://console.anthropic.com/account/keys" target="_blank" rel="noopener noreferrer"
              style={{ color: 'var(--color-gold)' }}>Get a key →</a>
          </p>
          <div style={{ display: 'flex', gap: 6 }}>
            <input className="input" type="password" placeholder="sk-ant-…"
              value={keyInput} onChange={e => setKeyInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleConnectKey()}
              style={{ flex: 1, fontSize: 'var(--text-xs)' }} />
            <button className="btn btn--primary btn--sm" onClick={handleConnectKey}>
              Connect
            </button>
          </div>
          {keyErr && <p style={{ color: 'var(--color-bear)', fontSize: 'var(--text-xs)', marginTop: 6 }}>{keyErr}</p>}
        </div>
      ) : (
        <>
          {/* Messages */}
          <div style={{ maxHeight: 220, overflowY: 'auto', padding: '8px 12px' }}>
            {messages.length === 0 && (
              <div>
                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-muted)', marginBottom: 8 }}>
                  Describe what you want — I'll configure this step for you.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {suggestions.map(s => (
                    <button key={s} onClick={() => send(s, step, form as unknown as Parameters<typeof send>[2], allFeatures)}
                      style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-sm)', padding: '5px 10px', cursor: 'pointer',
                        fontSize: 'var(--text-xs)', color: 'var(--color-muted)', textAlign: 'left',
                        transition: 'border-color 150ms' }}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map(msg => <Message key={msg.id} msg={msg} />)}
            {error && (
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-bear)', marginTop: 4 }}>{error}</p>
            )}
            <div ref={endRef} />
          </div>

          {/* Input */}
          <div style={{ display: 'flex', gap: 6, padding: '8px 12px',
            borderTop: '1px solid var(--color-border)' }}>
            <input
              className="input"
              placeholder="Ask anything about this step…"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
              disabled={streaming}
              style={{ flex: 1, fontSize: 'var(--text-xs)', padding: '6px 10px' }}
            />
            <button className="btn btn--primary btn--sm" onClick={handleSend}
              disabled={!input.trim() || streaming}>
              {streaming ? '…' : '→'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
