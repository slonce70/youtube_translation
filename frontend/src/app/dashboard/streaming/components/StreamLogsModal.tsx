import { X } from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'

import type { TranslationFn } from '../types'

type Props = {
  open: boolean
  logs?: string[]
  onClose: () => void
  t: TranslationFn
}

export function StreamLogsModal({ open, logs, onClose, t }: Props) {
  if (!open) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm px-4">
      <Card className="w-full max-w-4xl animate-scale-in">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{t('streams.logs.title')}</CardTitle>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="bg-slate-900 text-slate-100 rounded-lg p-4 font-mono text-xs max-h-96 overflow-y-auto">
            {logs?.length ? logs.map((line) => <p key={line}>{line}</p>) : <p>{t('streams.logs.empty')}</p>}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
