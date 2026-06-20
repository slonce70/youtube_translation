'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMessages, useTranslations } from 'next-intl'
import { translateSupabaseError } from '@/i18n/errorMessages'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { supabase } from '@/lib/supabase'
import { api } from '@/lib/api'
import { writeDevBypassDisplayName } from '@/lib/devBypassUser'
import { Youtube } from 'lucide-react'
import { useDashboardContext } from '../dashboard-context'
import { toast } from 'sonner'
import {
  getProviderBadgeVariant,
  getProviderHealthIssueCount,
  getProviderStatusKey,
  hasProviderHealthAttention,
} from '@/lib/provider-status'

// Sentinel error messages used internally by the password-update flow to
// distinguish UX-friendly mismatches from generic supabase errors. They are
// matched by reference, not displayed to the user — the real toast text
// always comes from the i18n layer (toasts.missingEmail / toasts.currentIncorrect).
const ERR_MISSING_EMAIL = 'profile.missingEmail'
const ERR_CURRENT_AUTH_INCORRECT = 'profile.currentAuthIncorrect'

export default function ProfilePage() {
  const devBypass = process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === '1'
  const { user, refreshUser } = useDashboardContext()
  const queryClient = useQueryClient()
  const t = useTranslations('profile')
  const toasts = useTranslations('profile.toasts')
  const supabaseErrors = useTranslations('errors.supabase')
  const profileMessages = useMessages() as {
    profile?: {
      profileForm?: {
        languageOptions?: string[]
        timezoneOptions?: string[]
      }
    }
  }
  const languageOptions = profileMessages.profile?.profileForm?.languageOptions ?? []
  const timezoneOptions = profileMessages.profile?.profileForm?.timezoneOptions ?? []
  const [displayName, setDisplayName] = useState('')
  const [profileLoading, setProfileLoading] = useState(false)
  const [languageLabel, setLanguageLabel] = useState(languageOptions[0] ?? '')
  const [timezoneLabel, setTimezoneLabel] = useState(timezoneOptions[0] ?? '')

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordLoading, setPasswordLoading] = useState(false)

  const { data: youtubeConnections } = useQuery({
    queryKey: ['youtube-connections', user?.id],
    queryFn: () => api.youtube.listConnections(),
    enabled: !!user,
    staleTime: 30_000,
  })

  const { data: youtubeOAuthConfig } = useQuery({
    queryKey: ['youtube-oauth-config', user?.id],
    queryFn: () => api.youtube.oauthConfig(),
    enabled: !!user,
    staleTime: 60_000,
  })

  const disconnectYoutubeMutation = useMutation({
    mutationFn: (connectionId: string) => api.youtube.deleteConnection(connectionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['youtube-connections', user?.id] })
      queryClient.invalidateQueries({ queryKey: ['streams', user?.id] })
      queryClient.invalidateQueries({ queryKey: ['destinations', user?.id] })
      toast.success(t('toasts.youtubeDisconnected'))
    },
    onError: (error: Error) => toast.error(error.message),
  })

  useEffect(() => {
    if (!user) return
    setDisplayName(user.user_metadata?.display_name ?? '')
  }, [user])

  useEffect(() => {
    if (typeof Intl === 'undefined') return
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Kyiv'
      if (tz.includes('Kyiv') || tz.includes('Kiev')) setTimezoneLabel(t('profileForm.timezoneKyiv'))
      else if (tz.includes('London')) setTimezoneLabel(t('profileForm.timezoneLondon'))
      else if (tz.includes('New_York')) setTimezoneLabel(t('profileForm.timezoneNewYork'))
    } catch {}
  }, [t])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const status = params.get('youtube_oauth')
    const message = params.get('youtube_message')
    if (!status) return
    if (status === 'success') {
      toast.success(t('toasts.youtubeConnected'))
      queryClient.invalidateQueries({ queryKey: ['youtube-connections', user?.id] })
    } else {
      toast.error(message || t('toasts.youtubeConnectFailed'))
    }
    params.delete('youtube_oauth')
    params.delete('youtube_message')
    const next = params.toString()
    window.history.replaceState({}, '', `${window.location.pathname}${next ? `?${next}` : ''}`)
  }, [queryClient, t, user?.id])

  const initials = useMemo(
    () => (displayName || user?.email || t('profileForm.userFallback')).charAt(0).toUpperCase(),
    [displayName, user?.email, t],
  )
  const formatProviderStatus = (status?: string | null) => t(`provider.status.${getProviderStatusKey(status)}`)
  const formatConnectionSummary = (connection: {
    provider_status?: string | null
    provider_viewers?: number | null
    provider_health_status?: string | null
    provider_health_issues?: string[] | null
  }) => {
    const parts = [formatProviderStatus(connection.provider_status)]
    if (typeof connection.provider_viewers === 'number') {
      parts.push(t('provider.viewers', { count: connection.provider_viewers }))
    }
    const issueCount = getProviderHealthIssueCount(connection)
    if (issueCount > 0) {
      parts.push(t('provider.healthIssues', { count: issueCount }))
    } else if (hasProviderHealthAttention(connection)) {
      parts.push(t('provider.healthDegraded'))
    }
    return parts.join(' · ')
  }

  const handleStartYouTubeConnect = async () => {
    try {
      const response = await api.youtube.oauthStart({
        redirect_origin: window.location.origin,
        redirect_path: '/dashboard/profile',
      })
      window.location.href = response.auth_url
    } catch (error) {
      const message = error instanceof Error ? error.message : t('provider.startFailed')
      toast.error(message)
    }
  }

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
      } else if (message === ERR_MISSING_EMAIL) {
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
        throw new Error(ERR_MISSING_EMAIL)
      }
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password: currentPassword })
      if (signInError) throw new Error(ERR_CURRENT_AUTH_INCORRECT)
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
      else if (message === ERR_MISSING_EMAIL) toast.error(toasts('missingEmail'))
      else if (message === ERR_CURRENT_AUTH_INCORRECT) toast.error(toasts('currentIncorrect'))
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
                <div style={{ fontWeight: 600 }}>{displayName || user?.email || t('profileForm.userFallback')}</div>
                <div style={{ color: 'var(--txt-2)', fontSize: 13 }}>{user?.email ?? ''}</div>
              </div>
              <Button variant="outline" size="sm" className="ml-auto" disabled>{t('profileForm.changePhoto')}</Button>
            </div>

            <form onSubmit={handleProfileSubmit} style={{ display: 'grid', gap: 16 }}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                  <label htmlFor="languageLabel" className="page-sub" style={{ display: 'block', marginBottom: 6 }}>{t('profileForm.languageLabel')}</label>
                  <select id="languageLabel" className="input" value={languageLabel} onChange={(event) => setLanguageLabel(event.target.value)} disabled>
                    {languageOptions.map((option) => <option key={option}>{option}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="timezoneLabel" className="page-sub" style={{ display: 'block', marginBottom: 6 }}>{t('profileForm.timezoneLabel')}</label>
                  <select id="timezoneLabel" className="input" value={timezoneLabel} onChange={(event) => setTimezoneLabel(event.target.value)} disabled>
                    {timezoneOptions.map((option) => <option key={option}>{option}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ color: 'var(--txt-3)', fontSize: 12 }}>
                {t('profileForm.preferencesNote')}
              </div>
              <div className="page-actions" style={{ marginLeft: 0 }}>
                <Button type="submit" isLoading={profileLoading}>{t('profileForm.save')}</Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('provider.title')}</CardTitle>
            <div className="card-description">{t('provider.description')}</div>
          </CardHeader>
          <CardContent>
            <div className="page-actions" style={{ marginLeft: 0, marginBottom: 16 }}>
              <Button
                onClick={handleStartYouTubeConnect}
                disabled={youtubeOAuthConfig?.configured === false}
                title={youtubeOAuthConfig?.configured === false ? t('provider.oauthUnavailable') : undefined}
              >
                {t('provider.connectCta')}
              </Button>
            </div>
            {youtubeOAuthConfig?.configured === false ? (
              <div className="card-description" style={{ marginBottom: 16 }}>
                {t('provider.oauthUnavailable')}
              </div>
            ) : null}
            {(youtubeConnections?.length ?? 0) > 0 ? (
              <div className="summary-list">
                {youtubeConnections?.map((connection) => (
                  <div key={connection.id} className="stream-row" style={{ alignItems: 'flex-start' }}>
                    <div className="stream-thumb" aria-hidden="true" style={{ color: '#ff0033' }}><Youtube className="h-5 w-5" /></div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600 }}>{connection.youtube_channel_title || connection.youtube_channel_id}</div>
                      <div style={{ fontSize: 13, color: 'var(--txt-2)' }}>{formatConnectionSummary(connection)}</div>
                      <div style={{ fontSize: 12, color: 'var(--txt-3)', marginTop: 6 }}>
                        {t('provider.channelId', { id: connection.youtube_channel_id })}
                        {connection.last_sync_at
                          ? ` · ${t('provider.lastSync', { value: new Date(connection.last_sync_at).toLocaleString() })}`
                          : ''}
                      </div>
                      {connection.last_sync_error ? (
                        <div style={{ fontSize: 12, color: 'var(--amber)', marginTop: 6 }}>
                          {t('provider.lastError', { value: connection.last_sync_error })}
                        </div>
                      ) : null}
                    </div>
                    <Badge variant={getProviderBadgeVariant(connection.provider_status)}>
                      {formatProviderStatus(connection.provider_status)}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => disconnectYoutubeMutation.mutate(connection.id)}
                      isLoading={disconnectYoutubeMutation.isPending && disconnectYoutubeMutation.variables === connection.id}
                    >
                      {t('provider.disconnectCta')}
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="stream-row" style={{ opacity: 0.85, alignItems: 'flex-start' }}>
                <div className="stream-thumb" aria-hidden="true"><Youtube className="h-5 w-5" /></div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{t('provider.emptyTitle')}</div>
                  <div style={{ fontSize: 13, color: 'var(--txt-2)' }}>{t('provider.emptyDescription')}</div>
                  <div style={{ fontSize: 12, color: 'var(--txt-3)', marginTop: 6 }}>{t('provider.emptyHint')}</div>
                </div>
                <Badge variant="idle">{t('provider.notConnected')}</Badge>
              </div>
            )}
          </CardContent>
        </Card>

        <Card id="password">
          <CardHeader>
            <CardTitle>{t('passwordForm.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handlePasswordSubmit} style={{ display: 'grid', gap: 16 }}>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
