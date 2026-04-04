'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { translateSupabaseError } from '@/i18n/errorMessages'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { supabase } from '@/lib/supabase'
import { writeDevBypassDisplayName } from '@/lib/devBypassUser'
import { useDashboardContext } from '../dashboard-context'
import { toast } from 'sonner'

export default function ProfilePage() {
  const devBypass = process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === '1'
  const { user, refreshUser } = useDashboardContext()
  const t = useTranslations('profile')
  const toasts = useTranslations('profile.toasts')
  const supabaseErrors = useTranslations('errors.supabase')
  const [displayName, setDisplayName] = useState('')
  const [profileLoading, setProfileLoading] = useState(false)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordLoading, setPasswordLoading] = useState(false)

  useEffect(() => {
    if (!user) return
    setDisplayName(user.user_metadata?.display_name ?? '')
  }, [user])

  const handleProfileSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!user) return

    setProfileLoading(true)
    try {
      if (devBypass) {
        writeDevBypassDisplayName(displayName)
      } else {
        const { error } = await supabase.auth.updateUser({
          data: {
            display_name: displayName,
          },
        })

        if (error) throw error
      }

      await refreshUser()
      toast.success(toasts('profileUpdated'))
    } catch (error: any) {
      const message = error instanceof Error ? error.message : null
      const translated = translateSupabaseError(error, supabaseErrors)
      if (translated) {
        toast.error(translated)
      } else if (message === 'Missing email on account') {
        toast.error(toasts('missingEmail'))
      } else {
        toast.error(message ?? toasts('profileUpdateError'))
      }
    } finally {
      setProfileLoading(false)
    }
  }

  const handlePasswordSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!user) return
    if (!currentPassword) {
      toast.error(toasts('currentRequired'))
      return
    }
    if (!newPassword || newPassword.length < 8) {
      toast.error(toasts('passwordTooShort'))
      return
    }

    if (newPassword !== confirmPassword) {
      toast.error(toasts('passwordMismatch'))
      return
    }

    setPasswordLoading(true)
    try {
      const email = user.email
      if (!email) {
        throw new Error('Missing email on account')
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password: currentPassword,
      })

      if (signInError) {
        throw new Error('Current password is incorrect')
      }

      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw error

      toast.success(toasts('passwordUpdated'))
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (error: any) {
      const message = error instanceof Error ? error.message : null
      const translated = translateSupabaseError(error, supabaseErrors)
      if (translated) {
        toast.error(translated)
      } else if (message === 'Missing email on account') {
        toast.error(toasts('missingEmail'))
      } else if (message === 'Current password is incorrect') {
        toast.error(toasts('currentIncorrect'))
      } else {
        toast.error(message ?? toasts('passwordUpdateError'))
      }
    } finally {
      setPasswordLoading(false)
    }
  }

  return (
    <div className="space-y-10">
      <div className="max-w-2xl">
        <Badge variant="secondary" className="mb-3 inline-flex items-center space-x-1">
          <span>{t('header.badge')}</span>
        </Badge>
        <h1 className="text-3xl font-bold gradient-text mb-2">{t('header.title')}</h1>
        <p className="text-slate-600 dark:text-slate-400">{t('header.description')}</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t('profileForm.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleProfileSubmit} className="grid gap-6 md:grid-cols-2">
              <div className="md:col-span-1">
                <label htmlFor="displayName" className="mb-2 block text-sm font-medium text-slate-600 dark:text-slate-300">
                  {t('profileForm.displayNameLabel')}
                </label>
                <Input
                  id="displayName"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder={t('profileForm.displayNamePlaceholder')}
                />
              </div>

              <div className="md:col-span-1">
                <label htmlFor="email" className="mb-2 block text-sm font-medium text-slate-600 dark:text-slate-300">
                  {t('profileForm.emailLabel')}
                </label>
                <Input id="email" value={user?.email ?? ''} disabled readOnly />
              </div>

              <div className="md:col-span-2 flex justify-end">
                <Button type="submit" isLoading={profileLoading} loadingText={t('profileForm.saving')}>
                  {t('profileForm.save')}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card id="password" className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t('passwordForm.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handlePasswordSubmit} className="grid gap-6 md:grid-cols-3">
              <div className="md:col-span-1">
                <label htmlFor="currentPassword" className="mb-2 block text-sm font-medium text-slate-600 dark:text-slate-300">
                  {t('passwordForm.currentLabel')}
                </label>
                <Input
                  id="currentPassword"
                  type="password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  placeholder={t('passwordForm.currentPlaceholder')}
                />
              </div>

              <div className="md:col-span-1">
                <label htmlFor="newPassword" className="mb-2 block text-sm font-medium text-slate-600 dark:text-slate-300">
                  {t('passwordForm.newLabel')}
                </label>
                <Input
                  id="newPassword"
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  placeholder={t('passwordForm.newPlaceholder')}
                />
              </div>

              <div className="md:col-span-1">
                <label htmlFor="confirmPassword" className="mb-2 block text-sm font-medium text-slate-600 dark:text-slate-300">
                  {t('passwordForm.confirmLabel')}
                </label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                />
              </div>

              <div className="md:col-span-3 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t('passwordForm.guideline')}
                </p>
                <Button type="submit" isLoading={passwordLoading} loadingText={t('passwordForm.submitting')}>
                  {t('passwordForm.submit')}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
