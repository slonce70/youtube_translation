'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { supabase } from '@/lib/supabase'
import { useDashboardContext } from '../dashboard-context'
import { toast } from 'sonner'

export default function ProfilePage() {
  const { user, refreshUser } = useDashboardContext()
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
      const { error } = await supabase.auth.updateUser({
        data: {
          display_name: displayName,
        },
      })

      if (error) throw error

      await refreshUser()
      toast.success('Profile updated')
    } catch (error: any) {
      toast.error(error.message || 'Unable to update profile')
    } finally {
      setProfileLoading(false)
    }
  }

  const handlePasswordSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!user) return
    if (!newPassword || newPassword.length < 8) {
      toast.error('Password must be at least 8 characters long')
      return
    }

    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match')
      return
    }

    setPasswordLoading(true)
    try {
      const email = user.email
      if (!email) {
        throw new Error('Missing email on account')
      }

      if (currentPassword) {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password: currentPassword,
        })

        if (signInError) {
          throw new Error('Current password is incorrect')
        }
      }

      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw error

      toast.success('Password updated')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (error: any) {
      toast.error(error.message || 'Unable to change password')
    } finally {
      setPasswordLoading(false)
    }
  }

  return (
    <div className="space-y-10">
      <div className="max-w-2xl">
        <Badge variant="secondary" className="mb-3 inline-flex items-center space-x-1">
          <span>Account</span>
        </Badge>
        <h1 className="text-3xl font-bold gradient-text mb-2">Profile &amp; Security</h1>
        <p className="text-slate-600 dark:text-slate-400">
          Update how your workspace shows up across dashboards and keep your credentials in sync.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Profile information</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleProfileSubmit} className="grid gap-6 md:grid-cols-2">
              <div className="md:col-span-1">
                <label htmlFor="displayName" className="mb-2 block text-sm font-medium text-slate-600 dark:text-slate-300">
                  Display name
                </label>
                <Input
                  id="displayName"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                  placeholder="How teammates see you"
                />
              </div>

              <div className="md:col-span-1">
                <label htmlFor="email" className="mb-2 block text-sm font-medium text-slate-600 dark:text-slate-300">
                  Email
                </label>
                <Input id="email" value={user?.email ?? ''} disabled readOnly />
              </div>

              <div className="md:col-span-2 flex justify-end">
                <Button type="submit" isLoading={profileLoading} loadingText="Saving">
                  Save changes
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card id="password" className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Update password</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handlePasswordSubmit} className="grid gap-6 md:grid-cols-3">
              <div className="md:col-span-1">
                <label htmlFor="currentPassword" className="mb-2 block text-sm font-medium text-slate-600 dark:text-slate-300">
                  Current password
                </label>
                <Input
                  id="currentPassword"
                  type="password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  placeholder="Optional re-auth"
                />
              </div>

              <div className="md:col-span-1">
                <label htmlFor="newPassword" className="mb-2 block text-sm font-medium text-slate-600 dark:text-slate-300">
                  New password
                </label>
                <Input
                  id="newPassword"
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  placeholder="At least 8 characters"
                />
              </div>

              <div className="md:col-span-1">
                <label htmlFor="confirmPassword" className="mb-2 block text-sm font-medium text-slate-600 dark:text-slate-300">
                  Confirm password
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
                  Strong passwords combine lowercase, uppercase, numbers, and symbols. Updating your password will sign out other active sessions.
                </p>
                <Button type="submit" isLoading={passwordLoading} loadingText="Updating">
                  Update password
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
