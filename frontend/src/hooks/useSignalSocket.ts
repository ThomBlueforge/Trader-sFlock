'use client'

import { useSharedSocket } from '@/contexts/WebSocketContext'
import type { WSEvent } from '@/types'

/**
 * Subscribe to the app-wide shared WebSocket.
 * All callers share a single connection — no per-component reconnects.
 */
export function useSignalSocket(onEvent: (e: WSEvent) => void): void {
  useSharedSocket(onEvent)
}
