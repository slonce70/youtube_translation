'use client'

import { motion } from 'framer-motion'
import { useTranslations } from 'next-intl'
import { CheckCircle, Database, X } from 'lucide-react'
import { Button } from '../ui/Button'
import { AnimatedBackground } from './AnimatedBackground'

type Props = {
  onStartStreaming?: () => void | Promise<void>
}

export function CTASection({ onStartStreaming }: Props) {
  const t = useTranslations('landing.cta')

  return (
    <section className="relative overflow-hidden py-24">
      <AnimatedBackground />

      <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center max-w-4xl mx-auto"
        >
          <h2 className="text-4xl md:text-5xl font-bold mb-6">
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-purple-600 via-purple-500 to-cyan-500 dark:from-purple-400 dark:via-purple-400 dark:to-cyan-400">
              {t('title')}
            </span>
          </h2>

          <p className="text-lg md:text-xl text-slate-600 dark:text-slate-300 mb-10">
            {t('subtitle')}
          </p>

          <Button
            size="lg"
            className="shadow-glow-lg text-lg py-6 px-10"
            onClick={() => {
              if (onStartStreaming) {
                void onStartStreaming()
              }
            }}
          >
            {t('button')}
          </Button>

          <div className="flex flex-wrap items-center justify-center gap-6 mt-10">
            <div className="flex items-center space-x-2 text-sm text-slate-600 dark:text-slate-400">
              <CheckCircle className="w-5 h-5 text-success-500" />
              <span>{t('trustIndicators.noCard')}</span>
            </div>
            <div className="flex items-center space-x-2 text-sm text-slate-600 dark:text-slate-400">
              <Database className="w-5 h-5 text-primary-500" />
              <span>{t('trustIndicators.freeStorage')}</span>
            </div>
            <div className="flex items-center space-x-2 text-sm text-slate-600 dark:text-slate-400">
              <X className="w-5 h-5 text-accent-500" />
              <span>{t('trustIndicators.cancelAnytime')}</span>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
