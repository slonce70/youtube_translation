'use client'

import { motion } from 'framer-motion'
import { Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'

interface LoadingStateProps {
  text?: string
}

export function LoadingState({ text }: LoadingStateProps) {
  const status = useTranslations('common.status')
  const message = text ?? status('loading')

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          className="inline-block"
        >
          <div className="relative">
            <div className="w-16 h-16 rounded-full border-4 border-slate-200 dark:border-slate-700" />
            <div className="absolute top-0 left-0 w-16 h-16 rounded-full border-4 border-transparent border-t-primary-500 border-r-accent-500" />
          </div>
        </motion.div>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="mt-4 text-slate-600 dark:text-slate-400"
        >
          {message}
        </motion.p>
      </div>
    </div>
  )
}

export function LoadingSpinner({ className = '' }: { className?: string }) {
  return (
    <motion.div
      animate={{ rotate: 360 }}
      transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
      className={className}
    >
      <Loader2 className="w-5 h-5" />
    </motion.div>
  )
}

export function SkeletonCard() {
  return (
    <div className="card animate-pulse">
      <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-3/4 mb-4" />
      <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded w-1/2 mb-2" />
      <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-full" />
    </div>
  )
}
