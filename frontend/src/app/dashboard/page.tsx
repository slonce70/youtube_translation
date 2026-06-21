// Mission Control overview is the operator's ops home (UX redesign 2026-06).
// Previously this route redirected to /dashboard/streaming; it now renders an
// at-a-glance health board (global health line + stream tiles + events feed).

import { OverviewPage } from './OverviewPage'

export default function DashboardPage() {
  return <OverviewPage />
}
