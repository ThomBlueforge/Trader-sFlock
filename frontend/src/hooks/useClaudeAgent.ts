'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentConfig } from '@/types'
import {
  buildSystemPrompt,
  extractConfig,
  getApiKey,
  streamMessage,
  type Message,
} from '@/lib/claude'
import { api } from '@/lib/api'

const MAX_TURNS = 10

export interface ChatMessage extends Message {
  id: string
  config?: AgentConfig | null
  streaming?: boolean
}

interface UseClaudeAgentReturn {
  messages:     ChatMessage[]
  streaming:    boolean
  error:        string | null
  hasKey:       boolean
  send:         (userText: string) => Promise<void>
  clear:        () => void
  lastConfig:   AgentConfig | null
}

export function useClaudeAgent(
  onConfig?: (config: AgentConfig) => void,
): UseClaudeAgentReturn {
  const [messages,  setMessages]  = useState<ChatMessage[]>([])
  const [streaming, setStreaming] = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const [hasKey,    setHasKey]    = useState(false)
  const [lastConfig, setLastConfig] = useState<AgentConfig | null>(null)

  // System prompt (built once and cached)
  const systemRef = useRef<string>('')

  // Check key on mount
  useEffect(() => {
    setHasKey(!!getApiKey())
  }, [])

  // Rebuild system prompt with feature registry
  const ensureSystemPrompt = useCallback(async () => {
    if (systemRef.current) return
    try {
      const features = await api.features('1d')
      systemRef.current = buildSystemPrompt(features)
    } catch {
      systemRef.current = buildSystemPrompt([])
    }
  }, [])

  const send = useCallback(
    async (userText: string) => {
      const key = getApiKey()
      if (!key) {
        setError('No API key — please add your Anthropic key in Settings.')
        return
      }

      setError(null)
      await ensureSystemPrompt()

      const userMsg: ChatMessage = {
        id:      crypto.randomUUID(),
        role:    'user',
        content: userText,
      }

      setMessages((prev) => {
        // Trim to MAX_TURNS pairs (20 messages = 10 turns)
        const trimmed = prev.slice(-(MAX_TURNS * 2 - 2))
        return [...trimmed, userMsg]
      })

      // Build message history for API (exclude streaming placeholders)
      const history: Message[] = []
      setMessages((prev) => {
        history.push(...prev.map(({ role, content }) => ({ role, content })))
        return prev
      })

      const assistantId = crypto.randomUUID()
      const placeholder: ChatMessage = {
        id:       assistantId,
        role:     'assistant',
        content:  '',
        streaming: true,
      }
      setMessages((prev) => [...prev, placeholder])
      setStreaming(true)

      let fullText = ''
      try {
        fullText = await streamMessage(
          key,
          systemRef.current,
          history,
          (token) => {
            fullText += token
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, content: fullText } : m,
              ),
            )
          },
          1024,
        )

        const config = extractConfig(fullText)

        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: fullText, streaming: false, config }
              : m,
          ),
        )

        if (config) {
          setLastConfig(config)
          onConfig?.(config)
        }
      } catch (err) {
        setError(String(err))
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: '⚠ Error: ' + String(err), streaming: false }
              : m,
          ),
        )
      } finally {
        setStreaming(false)
      }
    },
    [ensureSystemPrompt, onConfig],
  )

  const clear = useCallback(() => {
    setMessages([])
    setLastConfig(null)
    setError(null)
  }, [])

  return { messages, streaming, error, hasKey, send, clear, lastConfig }
}
