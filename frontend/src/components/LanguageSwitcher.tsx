'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'

const SUPPORTED_LOCALES = [
  { code: 'uk', label: 'Українська' },
  { code: 'ru', label: 'Русский' },
  { code: 'en', label: 'English' },
]

export function LanguageSwitcher() {
  const locale = useLocale()
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const t = useTranslations('nav.language')

  const currentLocale = SUPPORTED_LOCALES.find((item) => item.code === locale) ?? SUPPORTED_LOCALES[0]
  const [mounted, setMounted] = useState(false)
  const [selectedLocale, setSelectedLocale] = useState(currentLocale.code)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    setSelectedLocale(currentLocale.code)
  }, [currentLocale.code])

  const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const nextLocale = event.target.value

    if (nextLocale === locale) return

    setSelectedLocale(nextLocale)

    startTransition(() => {
      document.cookie = `NEXT_LOCALE=${nextLocale}; path=/; max-age=${60 * 60 * 24 * 365}`
      router.refresh()
    })
  }

  if (!mounted) {
    return (
      <label className="flex items-center space-x-2 text-sm text-slate-600 dark:text-slate-300" aria-label={t('label')}>
        <span className="hidden sm:inline-block">{t('label')}</span>
        <div className="h-8 w-20 rounded-lg bg-slate-200 dark:bg-slate-800" aria-hidden />
      </label>
    )
  }

  return (
    <label className="flex items-center space-x-2 text-sm text-slate-600 dark:text-slate-300">
      <span className="hidden sm:inline-block">{t('label')}</span>
      <select
        className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-800"
        value={selectedLocale}
        onChange={handleChange}
        disabled={isPending}
      >
        {SUPPORTED_LOCALES.map((item) => (
          <option key={item.code} value={item.code}>
            {item.label}
          </option>
        ))}
      </select>
    </label>
  )
}
