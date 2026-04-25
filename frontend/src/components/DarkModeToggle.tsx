'use client'

import { useCallback, useSyncExternalStore } from 'react'
import { Moon, Sun } from 'lucide-react'
import { motion } from 'framer-motion'
import { useTranslations } from 'next-intl'

const THEME_STORAGE_KEY = 'theme'
const DARK_CLASS = 'dark'

function readThemeIsDark(): boolean {
  if (typeof document === 'undefined') return false
  return document.documentElement.classList.contains(DARK_CLASS)
}

function subscribeToTheme(notify: () => void): () => void {
  if (typeof window === 'undefined') return () => {}

  const observer = new MutationObserver(notify)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  })

  // Cross-tab sync via the `storage` event so the toggle reflects theme
  // changes made on another tab.
  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY) notify()
  }
  window.addEventListener('storage', onStorage)

  return () => {
    observer.disconnect()
    window.removeEventListener('storage', onStorage)
  }
}

// SSR snapshot: assume light theme during render so the toggle's icon
// matches the inline early-evaluation script's default. The first
// useEffect-equivalent in the client subscribes and re-reads the real
// document.documentElement state synchronously.
//
// Trade-off: a user whose system / localStorage chose dark theme sees the
// Moon icon for one render frame after hydration, then snaps to Sun. The
// rest of the page is already dark (the inline `<head>` script in
// app/layout.tsx adds the `dark` class before paint), so the visible
// flash is contained to the 20×20 toggle. Avoiding it entirely requires
// either a cookie-based theme preference resolved server-side or a
// dedicated theme provider — out of scope for Sprint 3 and tracked as
// follow-up.
function getServerSnapshot(): boolean {
  return false
}

export function DarkModeToggle() {
  const t = useTranslations('common.theme')

  const isDark = useSyncExternalStore(subscribeToTheme, readThemeIsDark, getServerSnapshot)

  const toggleTheme = useCallback(() => {
    if (typeof document === 'undefined') return
    const next = !document.documentElement.classList.contains(DARK_CLASS)
    if (next) {
      document.documentElement.classList.add(DARK_CLASS)
      window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    } else {
      document.documentElement.classList.remove(DARK_CLASS)
      window.localStorage.setItem(THEME_STORAGE_KEY, 'light')
    }
  }, [])

  return (
    <motion.button
      onClick={toggleTheme}
      className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      aria-label={t('toggle')}
      suppressHydrationWarning
    >
      {isDark ? (
        <Sun className="w-5 h-5 text-yellow-500" />
      ) : (
        <Moon className="w-5 h-5 text-slate-600" />
      )}
    </motion.button>
  )
}
