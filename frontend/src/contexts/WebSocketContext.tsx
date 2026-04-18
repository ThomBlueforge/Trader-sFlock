'use client'

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from 'react'
import type { WSEvent } from '@/types'

type Listener = (ev: WSEvent) => void

interface WSContextValue {
  subscribe:   (cb: Listener) => () => void
  isConnected: () => boolean
}

const WebSocketContext = createContext<WSContextValue | null>(null)

const WS_BASE = process.env.NEXT_PUBLIC_WS_URL ?? 'ws://localhost:8000'

// ── Provider ───────────────────────────────────────────────────────────────────

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const listenersRef  = useRef<Set<Listener>>(new Set())
  const connectedRef  = useRef(false)
  const wsRef         = useRef<WebSocket | null>(null)

  useEffect(() => {
    let destroyed       = false
    let reconnectTimer: ReturnType<typeof setTimeout>

    function connect() {
      if (destroyed) return
      const ws = new WebSocket(`${WS_BASE}/api/ws`)
      wsRef.current = ws

      ws.onopen = () => {
        connectedRef.current = true
      }

      ws.onmessage = (ev: MessageEvent) => {
        try {
          const event = JSON.parse(ev.data as string) as WSEvent
          listenersRef.current.forEach((cb) => {
            try { cb(event) } catch { /* ignore listener errors */ }
          })
        } catch { /* ignore parse errors */ }
      }

      ws.onclose = () => {
        connectedRef.current = false
        wsRef.current = null
        if (!destroyed) {
          reconnectTimer = setTimeout(connect, 3_000)
        }
      }

      ws.onerror = () => ws.close()
    }

    // Small delay so React StrictMode's cleanup of the first mount
    // completes before we open the real connection
    reconnectTimer = setTimeout(connect, 50)

    return () => {
      destroyed = true
      clearTimeout(reconnectTimer)
      const socket = wsRef.current
      wsRef.current = null
      if (socket) {
        // Null handlers BEFORE close so the onclose reconnect-timer
        // doesn't fire and the onerror doesn't log a console warning
        socket.onopen  = null
        socket.onmessage = null
        socket.onerror = null
        socket.onclose = null
        socket.close()
      }
    }
  }, [])

  const subscribe = useCallback((cb: Listener): (() => void) => {
    listenersRef.current.add(cb)
    return () => listenersRef.current.delete(cb)
  }, [])

  const isConnected = useCallback(() => connectedRef.current, [])

  return (
    <WebSocketContext.Provider value={{ subscribe, isConnected }}>
      {children}
    </WebSocketContext.Provider>
  )
}

// ── Hook ───────────────────────────────────────────────────────────────────────

/**
 * Subscribe to the shared WebSocket.
 * The callback is stable via ref — no need to wrap in useCallback at the call site.
 */
export function useSharedSocket(onEvent: Listener): void {
  const ctx   = useContext(WebSocketContext)
  const cbRef = useRef(onEvent)

  // Keep ref current so the stable subscriber always calls the latest callback
  useEffect(() => {
    cbRef.current = onEvent
  })

  useEffect(() => {
    if (!ctx) return
    const unsubscribe = ctx.subscribe((ev) => cbRef.current(ev))
    return unsubscribe
  }, [ctx])
}
