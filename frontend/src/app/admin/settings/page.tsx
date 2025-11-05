'use client'

import { Bell, Shield, Database, Mail } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { useTranslations } from 'next-intl'

export default function AdminSettings() {
  const t = useTranslations('admin.settings')

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-3xl font-bold gradient-text mb-2">{t('header.title')}</h2>
        <p className="text-slate-600 dark:text-slate-400">
          {t('header.description')}
        </p>
      </div>

      {/* Settings Sections */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Notifications */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Bell className="w-5 h-5" />
              <span>{t('notifications.title')}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">{t('notifications.emailAlerts.label')}</p>
                <p className="text-sm text-slate-500">{t('notifications.emailAlerts.description')}</p>
              </div>
              <input type="checkbox" className="w-4 h-4" defaultChecked />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">{t('notifications.userSignups.label')}</p>
                <p className="text-sm text-slate-500">{t('notifications.userSignups.description')}</p>
              </div>
              <input type="checkbox" className="w-4 h-4" />
            </div>
            <Button size="sm" className="w-full">{t('notifications.save')}</Button>
          </CardContent>
        </Card>

        {/* Security */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Shield className="w-5 h-5" />
              <span>{t('security.title')}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">{t('security.twoFactor.label')}</p>
                <p className="text-sm text-slate-500">{t('security.twoFactor.description')}</p>
              </div>
              <input type="checkbox" className="w-4 h-4" defaultChecked />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">{t('security.loginAudit.label')}</p>
                <p className="text-sm text-slate-500">{t('security.loginAudit.description')}</p>
              </div>
              <input type="checkbox" className="w-4 h-4" defaultChecked />
            </div>
            <Button size="sm" className="w-full">{t('security.save')}</Button>
          </CardContent>
        </Card>

        {/* Database */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Database className="w-5 h-5" />
              <span>{t('database.title')}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {t('database.description')}
            </p>
            <Button size="sm" variant="secondary" className="w-full">{t('database.cleanup')}</Button>
            <Button size="sm" variant="secondary" className="w-full">{t('database.backup')}</Button>
          </CardContent>
        </Card>

        {/* Email */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Mail className="w-5 h-5" />
              <span>{t('email.title')}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {t('email.description')}
            </p>
            <Button size="sm" variant="secondary" className="w-full">{t('email.configure')}</Button>
            <Button size="sm" variant="secondary" className="w-full">{t('email.test')}</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
