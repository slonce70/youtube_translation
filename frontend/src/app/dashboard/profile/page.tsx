'use client'
/* eslint-disable i18next/no-literal-string */

import { useEffect, useMemo, useState } from 'react'
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

const LANGUAGE_OPTIONS = ['🇺🇦 Українська', '🇬🇧 English', '🇷🇺 Русский']
const TIMEZONE_OPTIONS = ['UTC+3 (Київ)', 'UTC+0 (Лондон)', 'UTC-5 (Нью-Йорк)']

export default function ProfilePage() {
  const devBypass = process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === '1'
  const { user, refreshUser } = useDashboardContext()
  const t = useTranslations('profile')
  const toasts = useTranslations('profile.toasts')
  const supabaseErrors = useTranslations('errors.supabase')
  const [displayName, setDisplayName] = useState('')
  const [profileLoading, setProfileLoading] = useState(false)
  const [languageLabel, setLanguageLabel] = useState(LANGUAGE_OPTIONS[0])
  const [timezoneLabel, setTimezoneLabel] = useState(TIMEZONE_OPTIONS[0])

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordLoading, setPasswordLoading] = useState(false)

  useEffect(() => {
    if (!user) return
    setDisplayName(user.user_metadata?.display_name ?? '')
  }, [user])

  useEffect(() => {
    if (typeof Intl === 'undefined') return
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Kyiv'
      if (tz.includes('Kyiv') || tz.includes('Kiev')) setTimezoneLabel('UTC+3 (Київ)')
      else if (tz.includes('London')) setTimezoneLabel('UTC+0 (Лондон)')
      else if (tz.includes('New_York')) setTimezoneLabel('UTC-5 (Нью-Йорк)')
    } catch {}
  }, [])

  const initials = useMemo(() => (displayName || user?.email || 'U').charAt(0).toUpperCase(), [displayName, user?.email])

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
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password: currentPassword })
      if (signInError) throw new Error('Current password is incorrect')
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw error

      toast.success(toasts('passwordUpdated'))
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (error: any) {
      const message = error instanceof Error ? error.message : null
      const translated = translateSupabaseError(error, supabaseErrors)
      if (translated) toast.error(translated)
      else if (message === 'Missing email on account') toast.error(toasts('missingEmail'))
      else if (message === 'Current password is incorrect') toast.error(toasts('currentIncorrect'))
      else toast.error(message ?? toasts('passwordUpdateError'))
    } finally {
      setPasswordLoading(false)
    }
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <div>
          <div className="page-title">{t('header.title')}</div>
          <div className="page-sub">{t('header.description')}</div>
        </div>
      </div>

      <div style={{ maxWidth: 980, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <Card>
          <CardContent>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
              <div className="avatar" style={{ width: 56, height: 56, fontSize: 22 }}>{initials}</div>
              <div>
                <div style={{ fontWeight: 600 }}>{displayName || user?.email || 'Користувач'}</div>
                <div style={{ color: 'var(--txt-2)', fontSize: 13 }}>{user?.email ?? ''}</div>
              </div>
              <Button variant="outline" size="sm" className="ml-auto" disabled>Змінити фото</Button>
            </div>

            <form onSubmit={handleProfileSubmit} style={{ display: 'grid', gap: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div>
                  <label htmlFor="displayName" className="page-sub" style={{ display: 'block', marginBottom: 6 }}>
                    {t('profileForm.displayNameLabel')}
                  </label>
                  <Input
                    id="displayName"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    placeholder={t('profileForm.displayNamePlaceholder')}
                  />
                </div>
                <div>
                  <label htmlFor="email" className="page-sub" style={{ display: 'block', marginBottom: 6 }}>
                    {t('profileForm.emailLabel')}
                  </label>
                  <Input id="email" value={user?.email ?? ''} disabled readOnly />
                </div>
                <div>
                  <label htmlFor="languageLabel" className="page-sub" style={{ display: 'block', marginBottom: 6 }}>Мова інтерфейсу</label>
                  <select id="languageLabel" className="input" value={languageLabel} onChange={(event) => setLanguageLabel(event.target.value)} disabled>
                    {LANGUAGE_OPTIONS.map((option) => <option key={option}>{option}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="timezoneLabel" className="page-sub" style={{ display: 'block', marginBottom: 6 }}>Часовий пояс</label>
                  <select id="timezoneLabel" className="input" value={timezoneLabel} onChange={(event) => setTimezoneLabel(event.target.value)} disabled>
                    {TIMEZONE_OPTIONS.map((option) => <option key={option}>{option}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ color: 'var(--txt-3)', fontSize: 12 }}>
                Налаштування мови та часового поясу будуть винесені в окрему backend-integrated фазу. Зараз зберігається ім’я профілю.
              </div>
              <div className="page-actions" style={{ marginLeft: 0 }}>
                <Button type="submit" isLoading={profileLoading}>{t('profileForm.save')}</Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>📺 Підключені платформи</CardTitle>
            <div className="card-description">Підключення через OAuth 2.0 буде додано у Phase 2. Фейкові статуси не показуємо.</div>
          </CardHeader>
          <CardContent>
            <div className="stream-row" style={{ opacity: 0.85, alignItems: 'flex-start' }}>
              <div className="stream-thumb">📡</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>YouTube / Twitch / Facebook</div>
                <div style={{ fontSize: 13, color: 'var(--txt-2)' }}>Підключення платформ буде доступне після реалізації реального OAuth backend flow.</div>
                <div style={{ fontSize: 12, color: 'var(--txt-3)', marginTop: 6 }}>Поки що використовуйте Custom RTMP у розділі «Трансляції».</div>
              </div>
              <Badge variant="idle">Відкладено</Badge>
            </div>
          </CardContent>
        </Card>

        <Card id="password">
          <CardHeader>
            <CardTitle>{t('passwordForm.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handlePasswordSubmit} style={{ display: 'grid', gap: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 16 }}>
                <div>
                  <label htmlFor="currentPassword" className="page-sub" style={{ display: 'block', marginBottom: 6 }}>{t('passwordForm.currentLabel')}</label>
                  <Input id="currentPassword" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} placeholder={t('passwordForm.currentPlaceholder')} />
                </div>
                <div>
                  <label htmlFor="newPassword" className="page-sub" style={{ display: 'block', marginBottom: 6 }}>{t('passwordForm.newLabel')}</label>
                  <Input id="newPassword" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder={t('passwordForm.newPlaceholder')} />
                </div>
                <div>
                  <label htmlFor="confirmPassword" className="page-sub" style={{ display: 'block', marginBottom: 6 }}>{t('passwordForm.confirmLabel')}</label>
                  <Input id="confirmPassword" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
                </div>
              </div>
              <div style={{ color: 'var(--txt-3)', fontSize: 12 }}>{t('passwordForm.guideline')}</div>
              <div className="page-actions" style={{ marginLeft: 0 }}>
                <Button type="submit" isLoading={passwordLoading}>{t('passwordForm.submit')}</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
