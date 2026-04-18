'use client'

import React, {
  createContext,
  useCallback,
  useContext,
  useState,
} from 'react'
import { useSharedSocket } from './WebSocketContext'
import type { WSEvent } from '@/types'

export interface Task {
  agent_id:   string
  type:       'training' | 'optimization'
  progress:   number
  status:     'running' | 'cancelling'
  started_at: number
}

interface TaskContextValue {
  tasks:          Record<string, Task>
  markCancelling: (agent_id: string) => void
  isRunning:      (agent_id: string) => boolean
}

const TaskContext = createContext<TaskContextValue>({
  tasks:          {},
  markCancelling: () => {},
  isRunning:      () => false,
})

export function TaskProvider({ children }: { children: React.ReactNode }) {
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
      } as Task,
    }))
  }, [])

  const remove = useCallback((agent_id: string) => {
    setTasks((prev) => {
      const next = { ...prev }
      delete next[agent_id]
      return next
    })
  }, [])

  useSharedSocket(
    useCallback(
      (ev: WSEvent) => {
        const aid = ev.data.agent_id as string | undefined
        if (!aid) return
      switch (ev.event) {
        case 'training_progress':
          setTasks(prev => {
            const existing = prev[aid]
            // If already cancelling, only update progress — never revert to 'running'
            const newStatus = existing?.status === 'cancelling' ? 'cancelling' : 'running'
            return {
              ...prev,
              [aid]: {
                ...(existing ?? {
                  agent_id: aid, type: 'training',
                  progress: 0, status: 'running', started_at: Date.now(),
                }),
                progress: ev.data.pct as number,
                status: newStatus,
              } as Task,
            }
          })
          break
        case 'training_complete':
        case 'training_error':
          remove(aid)
          break
      }
      },
      [upsert, remove],
    ),
  )

  const markCancelling = useCallback((agent_id: string) => {
    setTasks((prev) =>
      prev[agent_id]
        ? { ...prev, [agent_id]: { ...prev[agent_id], status: 'cancelling' } }
        : prev,
    )
  }, [])

  const isRunning = useCallback(
    (agent_id: string) => !!tasks[agent_id],
    [tasks],
  )

  return (
    <TaskContext.Provider value={{ tasks, markCancelling, isRunning }}>
      {children}
    </TaskContext.Provider>
  )
}

export function useTaskContext() {
  return useContext(TaskContext)
}
