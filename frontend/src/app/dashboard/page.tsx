// The standalone "Dashboard" home page was a low-fidelity mirror of the
// streams page (every CTA already routed there, the health bars were
// hard-coded, and the stat cards duplicated /dashboard/streaming's stat
// strip). UX restructure 2026-04-26 collapsed it into the streams page,
// which is the operator's actual landing surface. This file remains as a
// redirect target so old bookmarks and notification links keep working.

import { redirect } from 'next/navigation'

export default function DashboardPage() {
  redirect('/dashboard/streaming')
}
