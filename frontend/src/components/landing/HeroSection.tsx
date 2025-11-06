'use client'

import { motion } from 'framer-motion'
import { useTranslations } from 'next-intl'
import { Sparkles, ArrowRight, CheckCircle } from 'lucide-react'
import { Button } from '../ui/Button'
import { AnimatedBackground } from './AnimatedBackground'

type Props = {
  onStartStreaming?: () => void | Promise<void>
}

export function HeroSection({ onStartStreaming }: Props) {
  const t = useTranslations('landing.hero')

  return (
    <section className="relative min-h-[90vh] flex items-center justify-center overflow-hidden">
      <AnimatedBackground />

      <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-20">
        <div className="text-center max-w-4xl mx-auto">
          {/* Badge */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center space-x-2 mb-8"
          >
            <div className="glass rounded-full px-4 py-2 border border-slate-200/50 dark:border-slate-700/50">
              <div className="flex items-center space-x-2">
                <Sparkles className="w-4 h-4 text-primary-500" />
                <span className="text-sm font-medium bg-gradient-to-r from-primary-600 to-accent-600 bg-clip-text text-transparent">
                  {t('badge')}
                </span>
              </div>
            </div>
          </motion.div>

          {/* Main Heading */}
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="text-5xl md:text-6xl lg:text-7xl font-bold leading-tight mb-6"
          >
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-purple-600 via-purple-500 to-cyan-500 dark:from-purple-400 dark:via-purple-400 dark:to-cyan-400">
              {t('title')}
            </span>
          </motion.h1>

          {/* Subtitle */}
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="text-lg md:text-xl text-slate-600 dark:text-slate-400 mb-10 max-w-2xl mx-auto"
          >
            {t('subtitle')}
          </motion.p>

          {/* CTA Buttons */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-8"
          >
            <Button
              size="lg"
              className="shadow-glow-lg group"
              onClick={() => {
                if (onStartStreaming) {
                  void onStartStreaming()
                }
              }}
            >
              {t('primaryCTA')}
              <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
            </Button>
            <Button
              variant="secondary"
              size="lg"
              onClick={() => document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' })}
            >
              {t('secondaryCTA')}
            </Button>
          </motion.div>

          {/* Trust Indicator */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.4 }}
            className="flex items-center justify-center space-x-2 text-sm text-slate-500 dark:text-slate-400"
          >
            <CheckCircle className="w-4 h-4 text-success-500" />
            <span>{t('trustIndicator')}</span>
          </motion.div>
        </div>
      </div>
    </section>
  )
}
