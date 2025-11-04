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
      <Card className="relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 -mr-8 -mt-8 opacity-10">
          <div className={`w-full h-full rounded-full bg-gradient-to-br ${gradient}`} />
        </div>
        
        <div className="relative flex items-center space-x-4">
          <div className={`p-3 rounded-xl bg-gradient-to-br ${gradient} shadow-lg`}>
            <Icon className="w-6 h-6 text-white" />
          </div>
          
          <div className="flex-1">
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{title}</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{value}</p>
          </div>
        </div>
      </Card>
    </motion.div>
  )
}
