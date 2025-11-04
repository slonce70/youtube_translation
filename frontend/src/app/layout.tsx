import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import '@uppy/core/css/style.css'
import '@uppy/dashboard/css/style.css'
import { Providers } from './providers'
import { Toaster } from '@/components/Toaster'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'YouTube Multi-Channel Streaming',
  description: '24/7 streaming service for multiple YouTube channels',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <Providers>
          {children}
          <Toaster />
        </Providers>
      </body>
    </html>
  )
}
