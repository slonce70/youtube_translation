'use client'

import Link from 'next/link'
import { useEffect } from 'react'
import { useTranslations } from 'next-intl'

import { logger } from '@/lib/logger'

interface DashboardErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

export default function DashboardError({ error, reset }: DashboardErrorProps) {
  const t = useTranslations('errors.boundary')

  useEffect(() => {
    logger.error('dashboard error boundary', {
      message: error.message,
      digest: error.digest,
    })
  }, [error])

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6">
      <div className="max-w-md text-center">
        <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
          {t('title')}
        </h2>
        <p className="mt-3 text-slate-600 dark:text-slate-400">
          {t('description')}
        </p>
        {error.digest && (
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-500">
            #{error.digest}
          </p>
        )}
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
          >
            {t('tryAgain')}
          </button>
          <Link
            href="/dashboard"
            className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {t('back')}
          </Link>
        </div>
      </div>
    </div>
  )
}
