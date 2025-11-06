'use client'

import { motion } from 'framer-motion'
import { useTranslations } from 'next-intl'
import { Radio, TvMinimal, Gauge, Zap, Shield, Upload } from 'lucide-react'
import { SectionContainer } from './SectionContainer'

const features = [
  { key: 'streaming', icon: Radio, gradient: 'from-purple-500 to-pink-500' },
  { key: 'multiChannel', icon: TvMinimal, gradient: 'from-cyan-500 to-blue-500' },
  { key: 'quota', icon: Gauge, gradient: 'from-emerald-500 to-green-500' },
  { key: 'quality', icon: Zap, gradient: 'from-amber-500 to-orange-500' },
  { key: 'schedule', icon: Shield, gradient: 'from-violet-500 to-purple-500' },
  { key: 'uploads', icon: Upload, gradient: 'from-rose-500 to-pink-500' },
]

export function FeaturesGrid() {
  const t = useTranslations('landing.features')

  return (
    <SectionContainer id="features">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
      >
        <h2 className="text-3xl md:text-4xl font-bold gradient-text text-center mb-12">
          {t('title')}
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, index) => {
            const Icon = feature.icon
            return (
              <motion.div
                key={feature.key}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
                whileHover={{ scale: 1.02, y: -4 }}
                className="card relative overflow-hidden group"
              >
                <div className={`absolute top-0 right-0 w-32 h-32 -mr-8 -mt-8 opacity-10`}>
                  <div className={`w-full h-full rounded-full bg-gradient-to-br ${feature.gradient}`} />
                </div>

                <div className="relative">
                  <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${feature.gradient} flex items-center justify-center shadow-lg mb-4 group-hover:shadow-xl transition-shadow`}>
                    <Icon className="w-6 h-6 text-white" />
                  </div>

                  <h3 className="text-xl font-semibold text-slate-900 dark:text-white mb-2">
                    {t(`items.${feature.key}.title`)}
                  </h3>

                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    {t(`items.${feature.key}.description`)}
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
