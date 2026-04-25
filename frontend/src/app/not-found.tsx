import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

export default async function RootNotFound() {
  const t = await getTranslations('errors.notFound')

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="max-w-md text-center">
        <p className="text-7xl font-extrabold text-primary-500">404</p>
        <h1 className="mt-4 text-3xl font-bold text-slate-900 dark:text-slate-100">
          {t('title')}
        </h1>
        <p className="mt-3 text-slate-600 dark:text-slate-400">
          {t('description')}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link
            href="/"
            className="rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-700"
          >
            {t('backHome')}
          </Link>
          <Link
            href="/dashboard"
            className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {t('backDashboard')}
          </Link>
        </div>
      </div>
    </div>
  )
}
