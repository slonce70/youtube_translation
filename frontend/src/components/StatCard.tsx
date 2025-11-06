'use client'

import { motion } from 'framer-motion'
import { LucideIcon } from 'lucide-react'
import { Card } from './ui/Card'

interface StatCardProps {
  title: string
  value: string | number
  icon: LucideIcon
  gradient?: string
  delay?: number
}

export function StatCard({ title, value, icon: Icon, gradient = 'from-primary-500 to-purple-500', delay = 0 }: StatCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay }}
      whileHover={{ scale: 1.05, y: -5 }}
    >
      <Card className="relative flex h-full min-h-[150px] flex-col justify-center overflow-hidden hover:scale-100">
        <div className="absolute -right-8 -top-8 h-32 w-32 opacity-10">
          <div className={`h-full w-full rounded-full bg-gradient-to-br ${gradient}`} />
        </div>

        <div className="relative flex items-center gap-4">
          <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${gradient} shadow-lg`}>
            <Icon className="h-6 w-6 text-white" />
          </div>

          <div className="flex-1">
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{title}</p>
            <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{value}</p>
          </div>
        </div>
      </Card>
    </motion.div>
  )
}
