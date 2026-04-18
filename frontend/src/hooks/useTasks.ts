'use client'

import { useCallback, useState } from 'react'
import { useSignalSocket } from './useSignalSocket'
import type { WSEvent } from '@/types'

export type TaskType = 'training' | 'optimization' | 'monte_carlo'
export type TaskStatus = 'running' | 'cancelling'

export interface Task {
  agent_id:   string
  type:       TaskType
  progress:   number       // 0-100
  status:     TaskStatus
  started_at: number       // Date.now()
  label?:     string       // friendly name injected by TaskPanel
}

export function useTasks() {
  const [tasks, setTasks] = useState<Record<string, Task>>({})

  const upsert = useCallback((agent_id: string, updates: Partial<Task>) => {
    setTasks((prev) => ({
      ...prev,
      [agent_id]: {
        ...(prev[agent_id] ?? {
          agent_id,
          type:       'training',
          progress:   0,
          status:     'running',
          started_at: Date.now(),
        }),
        ...updates,
      },
    }))
  }, [])

  const remove = useCallback((agent_id: string) => {
    setTasks((prev) => {
      const next = { ...prev }
      delete next[agent_id]
      return next
    })
  }, [])

  const handleEvent = useCallback(
    (ev: WSEvent) => {
      const aid = ev.data.agent_id as string | undefined
      if (!aid) return

      switch (ev.event) {
        case 'training_progress':
          upsert(aid, { progress: ev.data.pct as number, type: 'training', status: 'running' })
          break
        case 'training_complete':
          remove(aid)
          break
        case 'training_error': {
          const err = (ev.data.error as string) ?? ''
          // "Cancelled" means a deliberate cancel, not a real failure
          remove(aid)
          break
        }
        // setup_test / monte_carlo completions
        default:
          break
      }
    },
    [upsert, remove],
  )

  useSignalSocket(handleEvent)

  /** Mark a task as waiting for cancellation (button feedback before server acks) */
  const markCancelling = useCallback((agent_id: string) => {
    setTasks((prev) =>
      prev[agent_id]
        ? { ...prev, [agent_id]: { ...prev[agent_id], status: 'cancelling' } }
        : prev,
    )
  }, [])

  return { tasks, markCancelling }
}
