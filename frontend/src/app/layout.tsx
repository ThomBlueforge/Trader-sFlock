import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import Navbar from '@/components/layout/Navbar'
import TaskPanelWrapper from '@/components/layout/TaskPanelWrapper'
import AppProviders from '@/components/layout/AppProviders'

import '@/styles/tokens.css'
import '@/styles/global.css'
import '@/styles/typography.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: "Trader's Flock — Gold Signal Intelligence",
  description: 'Multi-timeframe ML signal agents for gold (XAUUSD). Built for precision, coordinated by design.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body>
        <AppProviders>
          <div className="page-wrapper">
            <Navbar />
            <main className="main-content">{children}</main>
            <TaskPanelWrapper />
          </div>
        </AppProviders>
      </body>
    </html>
  )
}
