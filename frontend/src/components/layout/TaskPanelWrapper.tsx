'use client'

import { useAgents } from '@/hooks/useAgents'
import TaskPanel from './TaskPanel'

/**
 * Thin wrapper so layout.tsx (server component) can include the TaskPanel.
 * Fetches the agent list and passes it down for name resolution.
 */
export default function TaskPanelWrapper() {
  const { agents } = useAgents()
  return <TaskPanel agents={agents} />
}
