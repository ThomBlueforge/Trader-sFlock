'use client'

import { useEffect } from 'react'
import { WebSocketProvider } from '@/contexts/WebSocketContext'
import { TaskProvider }      from '@/contexts/TaskContext'
import { initApiKey }        from '@/lib/claude'

function KeyInitialiser() {
  useEffect(() => { initApiKey() }, [])
  return null
}

export default function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <WebSocketProvider>
      <TaskProvider>
        <KeyInitialiser />
        {children}
      </TaskProvider>
    </WebSocketProvider>
  )
}
