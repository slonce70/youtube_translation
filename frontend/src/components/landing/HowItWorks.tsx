'use client'

import { motion } from 'framer-motion'
import { useTranslations } from 'next-intl'
import { Upload, ListPlus, Play, BarChart3 } from 'lucide-react'
import { SectionContainer } from './SectionContainer'

const steps = [
  { key: 'upload', icon: Upload, gradient: 'from-purple-500 to-pink-500' },
  { key: 'playlist', icon: ListPlus, gradient: 'from-cyan-500 to-blue-500' },
  { key: 'stream', icon: Play, gradient: 'from-emerald-500 to-green-500' },
  { key: 'monitor', icon: BarChart3, gradient: 'from-amber-500 to-orange-500' },
]

export function HowItWorks() {
  const t = useTranslations('landing.howItWorks')

  return (
    <SectionContainer id="how-it-works" className="bg-slate-50 dark:bg-slate-900/50">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
      >
        <h2 className="text-3xl md:text-4xl font-bold gradient-text text-center mb-16">
          {t('title')}
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 relative">
          <div className="hidden lg:block absolute top-16 left-0 right-0 h-0.5">
            <div className="h-full w-full bg-gradient-to-r from-purple-500 via-cyan-500 to-amber-500 opacity-30" />
          </div>

          {steps.map((step, index) => {
            const Icon = step.icon
            return (
              <motion.div
                key={step.key}
                initial={{ opacity: 0, scale: 0.9 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.15 }}
                whileHover={{ scale: 1.03 }}
                className="relative"
              >
                <div className="card text-center">
                  <div className="text-6xl font-bold mb-4 bg-gradient-to-r from-purple-600 to-cyan-600 bg-clip-text text-transparent">
                    {index + 1}
                  </div>

                  <div className="flex justify-center mb-4">
                    <div className={`w-14 h-14 rounded-full bg-gradient-to-br ${step.gradient} flex items-center justify-center shadow-lg`}>
                      <Icon className="w-7 h-7 text-white" />
                    </div>
                  </div>

                  <h3 className="text-xl font-bold text-slate-900 dark:text-white mb-3">
                    {t(`steps.${step.key}.title`)}
                  </h3>

                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    {t(`steps.${step.key}.description`)}
                  </p>
                </div>
              </motion.div>
            )
          })}
        </div>
      </motion.div>
    </SectionContainer>
  )
}
