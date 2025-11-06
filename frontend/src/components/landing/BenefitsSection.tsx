'use client'

import { motion } from 'framer-motion'
import { useTranslations } from 'next-intl'
import { Zap, Shield, Upload, Activity } from 'lucide-react'
import { SectionContainer } from './SectionContainer'

const benefits = [
  { key: 'quality', icon: Zap, gradient: 'from-amber-500 to-orange-500' },
  { key: 'secure', icon: Shield, gradient: 'from-emerald-500 to-green-500' },
  { key: 'simple', icon: Upload, gradient: 'from-purple-500 to-pink-500' },
  { key: 'support', icon: Activity, gradient: 'from-cyan-500 to-blue-500' },
]

export function BenefitsSection() {
  const t = useTranslations('landing.benefits')

  return (
    <SectionContainer id="benefits">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.6 }}
      >
        <h2 className="text-3xl md:text-4xl font-bold gradient-text text-center mb-12">
          {t('title')}
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {benefits.map((benefit, index) => {
            const Icon = benefit.icon
            return (
              <motion.div
                key={benefit.key}
                initial={{ opacity: 0, x: index % 2 === 0 ? -20 : 20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
                whileHover={{ x: 4 }}
                className="card border-l-4 border-transparent"
                style={{
                  borderImage: `linear-gradient(to bottom, ${
                    benefit.gradient.includes('amber') ? '#f59e0b, #ea580c' :
                    benefit.gradient.includes('emerald') ? '#10b981, #059669' :
                    benefit.gradient.includes('purple') ? '#a855f7, #ec4899' :
                    '#06b6d4, #0284c7'
                  }) 1`,
                }}
              >
                <div className="flex items-start space-x-4">
                  <div className={`flex-shrink-0 w-20 h-20 rounded-full bg-gradient-to-br ${benefit.gradient} flex items-center justify-center shadow-lg`}>
                    <Icon className="w-10 h-10 text-white" />
                  </div>

                  <div className="flex-1">
                    <h3 className="text-2xl font-bold text-slate-900 dark:text-white mb-3">
                      {t(`items.${benefit.key}.title`)}
                    </h3>
                    <p className="text-base text-slate-600 dark:text-slate-400">
                      {t(`items.${benefit.key}.description`)}
                    </p>
                  </div>
                </div>
              </motion.div>
            )
          })}
        </div>
      </motion.div>
    </SectionContainer>
  )
}
