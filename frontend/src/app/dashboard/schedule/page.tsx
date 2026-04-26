// The standalone "Schedule" page was 154 LOC of calendar-shaped redirector:
// every cell click and CTA navigated back into /dashboard/streaming
// (?editStream=… or ?new=1). It paid for a top-level sidebar slot without
// owning any unique logic. UX restructure 2026-04-26 folded it into the
// streams page, where scheduling will live as a per-stream tab once the
// per-stream detail route lands. This file remains as a redirect target so
// old bookmarks keep working.

import { redirect } from 'next/navigation'

export default function SchedulePage() {
  redirect('/dashboard/streaming')
}
