import type { Metadata } from 'next'
import { IBM_Plex_Serif, Inter, Manrope } from 'next/font/google'
import { setRequestLocale, getLocale } from 'next-intl/server'
import './globals.css'
import '@uppy/core/css/style.css'
import '@uppy/dashboard/css/style.css'
import { Providers } from './providers'
import { Toaster } from '@/components/Toaster'
import { loadMessages } from '@/messages'
import { defaultLocale, locales, type Locale } from '@/i18n/config'
import { buildMetadata } from './metadata'
import { StructuredData } from './structured-data'

export const dynamic = 'force-dynamic'

const inter = Inter({ subsets: ['latin', 'cyrillic'] })
const ibmPlexSerif = IBM_Plex_Serif({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-display',
})
const manrope = Manrope({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-tech',
})

export async function generateMetadata(): Promise<Metadata> {
  const locale = (await getLocale()) as Locale
  return buildMetadata({ locale, path: '/' })
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  let locale = (await getLocale()) as Locale
  if (!locales.includes(locale)) {
    locale = defaultLocale
  }

  setRequestLocale(locale)
  const messages = await loadMessages(locale)

  return (
    <html lang={locale} suppressHydrationWarning data-scroll-behavior="smooth">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                const theme = localStorage.getItem('theme') || 
                  (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
                if (theme === 'dark') {
                  document.documentElement.classList.add('dark');
                }
              } catch (e) {}
            `,
          }}
        />
      </head>
      <body className={`${inter.className} ${ibmPlexSerif.variable} ${manrope.variable}`} suppressHydrationWarning>
        <Providers locale={locale} messages={messages}>
          {children}
          <Toaster />
        </Providers>
        <StructuredData locale={locale} path="/" kind="root" />
      </body>
    </html>
  )
}
