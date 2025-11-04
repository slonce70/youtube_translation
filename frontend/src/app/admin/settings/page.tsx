'use client'

import { Settings as SettingsIcon, Bell, Shield, Database, Mail } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'

export default function AdminSettings() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-3xl font-bold gradient-text mb-2">Admin Settings</h2>
        <p className="text-slate-600 dark:text-slate-400">
          Configure system settings and preferences
        </p>
      </div>

      {/* Settings Sections */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Notifications */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Bell className="w-5 h-5" />
              <span>Notifications</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Email Alerts</p>
                <p className="text-sm text-slate-500">Receive email for critical alerts</p>
              </div>
              <input type="checkbox" className="w-4 h-4" defaultChecked />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">User Signups</p>
                <p className="text-sm text-slate-500">Notify on new user registrations</p>
              </div>
              <input type="checkbox" className="w-4 h-4" />
            </div>
            <Button size="sm" className="w-full">Save Settings</Button>
          </CardContent>
        </Card>

        {/* Security */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Shield className="w-5 h-5" />
              <span>Security</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Two-Factor Auth</p>
                <p className="text-sm text-slate-500">Enable 2FA for admin accounts</p>
              </div>
              <input type="checkbox" className="w-4 h-4" defaultChecked />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Login Audit</p>
                <p className="text-sm text-slate-500">Log all admin login attempts</p>
              </div>
              <input type="checkbox" className="w-4 h-4" defaultChecked />
            </div>
            <Button size="sm" className="w-full">Save Settings</Button>
          </CardContent>
        </Card>

        {/* Database */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Database className="w-5 h-5" />
              <span>Database</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Database maintenance and backup settings
            </p>
            <Button size="sm" variant="secondary" className="w-full">Run Cleanup</Button>
            <Button size="sm" variant="secondary" className="w-full">Create Backup</Button>
          </CardContent>
        </Card>

        {/* Email */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2">
              <Mail className="w-5 h-5" />
              <span>Email Configuration</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Configure email service provider and templates
            </p>
            <Button size="sm" variant="secondary" className="w-full">Configure SMTP</Button>
            <Button size="sm" variant="secondary" className="w-full">Test Email</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
