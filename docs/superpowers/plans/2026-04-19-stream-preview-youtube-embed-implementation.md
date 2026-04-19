# Stream Preview Via YouTube Embed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an inline operator preview on the streaming page that opens a YouTube embed for the currently live stream without adding meaningful server load, and fix the collapsed sidebar go-live icon alignment issue reported during review.

**Architecture:** Keep the streaming page lightweight by deriving preview state from the existing `Stream` payload and rendering only one mounted iframe at a time. Split the work into a tiny preview helper, a focused preview panel component, and a small `StreamsList` wiring pass; handle the sidebar icon issue as a narrow dashboard-shell polish so it does not sprawl into the preview feature.

**Tech Stack:** Next.js App Router, React 19, TypeScript, next-intl, Jest, Testing Library, CSS in `globals.css`

---

## File Map

- Create: `frontend/src/app/dashboard/streaming/preview.ts`
  Purpose: centralize preview-state rules and YouTube embed URL generation.
- Create: `frontend/src/app/dashboard/streaming/__tests__/preview.test.ts`
  Purpose: unit coverage for preview eligibility and embed URL shape.
- Create: `frontend/src/app/dashboard/streaming/components/StreamPreviewPanel.tsx`
  Purpose: render the ready/pending preview surface without bloating `StreamsList.tsx`.
- Modify: `frontend/src/app/dashboard/streaming/components/StreamsList.tsx`
  Purpose: own the single-open-preview state, row click behavior, and action-button event boundaries.
- Modify: `frontend/src/app/dashboard/streaming/components/__tests__/StreamsList.test.tsx`
  Purpose: interaction tests for opening, switching, and suppressing previews.
- Modify: `frontend/src/messages/en/streaming.json`
- Modify: `frontend/src/messages/uk/streaming.json`
- Modify: `frontend/src/messages/ru/streaming.json`
  Purpose: add preview copy for ready and pending states.
- Create: `frontend/src/components/layout/__tests__/Sidebar.test.tsx`
  Purpose: regression coverage for the collapsed go-live CTA structure.
- Modify: `frontend/src/components/layout/Sidebar.tsx`
  Purpose: make the go-live CTA icon structurally stable when collapsed.
- Modify: `frontend/src/app/globals.css`
  Purpose: center the icon-only collapsed CTA and keep sidebar controls visually aligned.

---

### Task 1: Add failing preview helper tests

**Files:**
- Create: `frontend/src/app/dashboard/streaming/__tests__/preview.test.ts`
- Create: `frontend/src/app/dashboard/streaming/preview.ts`

- [ ] **Step 1: Write the failing helper test file**

```ts
import type { Stream } from '@/lib/types'

import {
  buildYouTubeEmbedUrl,
  getStreamPreviewState,
} from '../preview'

function makeStream(overrides: Partial<Stream> = {}): Stream {
  return {
    id: 'stream-1',
    playlist_id: 'playlist-1',
    source_type: 'playlist',
    name: 'Preview stream',
    status: 'running',
    pid: 123,
    log_path: null,
    error_message: null,
    started_at: '2026-04-19T18:00:00Z',
    stopped_at: null,
    video_collection_id: null,
    audio_collection_id: null,
    mix_mode: 'video_only',
    settings_json: {},
    total_duration_seconds: 120,
    created_at: '2026-04-19T17:55:00Z',
    updated_at: '2026-04-19T18:01:00Z',
    stream_assets: [],
    destinations: [],
    provider_status: 'live',
    provider_video_id: 'abc123xyz',
    provider_viewers: null,
    provider_last_checked_at: null,
    provider_stream_status: null,
    provider_health_status: null,
    provider_health_issues: [],
    provider_mismatch: false,
    scheduled_start_enabled: false,
    scheduled_start_time: null,
    scheduled_stop_time: null,
    uptime_seconds: 30,
    runtime_restart: {
      enabled: false,
      state: 'disabled',
      attempts: 0,
      max_attempts: 0,
      next_restart_at: null,
      last_restart_at: null,
      last_failure_at: null,
    },
    ...overrides,
  }
}

describe('stream preview helpers', () => {
  it('builds a muted youtube embed url', () => {
    expect(buildYouTubeEmbedUrl('abc123xyz')).toBe(
      'https://www.youtube.com/embed/abc123xyz?autoplay=1&mute=1&playsinline=1&rel=0',
    )
  })

  it('marks a live stream with provider video id as ready', () => {
    expect(getStreamPreviewState(makeStream())).toEqual({
      kind: 'ready',
      videoId: 'abc123xyz',
    })
  })

  it('marks a running stream without provider video id as pending', () => {
    expect(
      getStreamPreviewState(
        makeStream({
          provider_video_id: null,
          provider_status: 'unknown',
        }),
      ),
    ).toEqual({
      kind: 'pending',
      videoId: null,
    })
  })

  it('marks a stopped stream without provider metadata as unavailable', () => {
    expect(
      getStreamPreviewState(
        makeStream({
          status: 'stopped',
          provider_status: 'offline',
          provider_video_id: null,
        }),
      ),
    ).toEqual({
      kind: 'unavailable',
      videoId: null,
    })
  })
})
```

- [ ] **Step 2: Run the helper test to verify it fails**

Run:

```bash
cd ~/Documents/Work/youtube_translation/.worktrees/stream-preview-youtube-embed/frontend
npm test -- --runInBand src/app/dashboard/streaming/__tests__/preview.test.ts
```

Expected: FAIL because `../preview` does not exist yet.

- [ ] **Step 3: Write the minimal helper implementation**

```ts
import type { Stream } from '@/lib/types'

export type StreamPreviewState =
  | { kind: 'ready'; videoId: string }
  | { kind: 'pending'; videoId: null }
  | { kind: 'unavailable'; videoId: null }

export function buildYouTubeEmbedUrl(videoId: string): string {
  const params = new URLSearchParams({
    autoplay: '1',
    mute: '1',
    playsinline: '1',
    rel: '0',
  })

  return `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?${params.toString()}`
}

export function getStreamPreviewState(stream: Stream): StreamPreviewState {
  if (stream.provider_video_id) {
    return { kind: 'ready', videoId: stream.provider_video_id }
  }

  if (stream.status === 'running' || stream.status === 'starting') {
    return { kind: 'pending', videoId: null }
  }

  return { kind: 'unavailable', videoId: null }
}
```

- [ ] **Step 4: Re-run the helper test and verify it passes**

Run:

```bash
cd ~/Documents/Work/youtube_translation/.worktrees/stream-preview-youtube-embed/frontend
npm test -- --runInBand src/app/dashboard/streaming/__tests__/preview.test.ts
```

Expected: PASS for all four helper tests.

- [ ] **Step 5: Commit the helper foundation**

```bash
cd ~/Documents/Work/youtube_translation/.worktrees/stream-preview-youtube-embed
git add frontend/src/app/dashboard/streaming/preview.ts frontend/src/app/dashboard/streaming/__tests__/preview.test.ts
git commit -m "test: add stream preview helper coverage"
```

---

### Task 2: Add the preview panel component

**Files:**
- Create: `frontend/src/app/dashboard/streaming/components/StreamPreviewPanel.tsx`
- Modify: `frontend/src/app/dashboard/streaming/preview.ts`

- [ ] **Step 1: Add a focused component contract before wiring it into the list**

```ts
type StreamPreviewPanelProps = {
  title: string
  badge: string
  latencyHint: string
  pendingTitle: string
  pendingDescription: string
  embedUrl: string | null
  state: 'ready' | 'pending'
}
```

Add the new component file with a minimal render that supports only the two non-hidden states:

```tsx
type StreamPreviewPanelProps = {
  title: string
  badge: string
  latencyHint: string
  pendingTitle: string
  pendingDescription: string
  embedUrl: string | null
  state: 'ready' | 'pending'
}

export function StreamPreviewPanel({
  title,
  badge,
  latencyHint,
  pendingTitle,
  pendingDescription,
  embedUrl,
  state,
}: StreamPreviewPanelProps) {
  if (state === 'pending') {
    return (
      <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/50">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-900 dark:text-white">{pendingTitle}</p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{pendingDescription}</p>
          </div>
          <span className="rounded-full border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 dark:border-slate-700 dark:text-slate-300">
            {badge}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/50">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-900 dark:text-white">{title}</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{latencyHint}</p>
        </div>
        <span className="rounded-full border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 dark:border-slate-700 dark:text-slate-300">
          {badge}
        </span>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-black dark:border-slate-800">
        <div className="aspect-video">
          <iframe
            title={title}
            src={embedUrl ?? undefined}
            className="h-full w-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Keep `preview.ts` small and reusable**

Add one helper that converts the ready state into the final URL:

```ts
export function getStreamPreviewEmbedUrl(stream: Stream): string | null {
  const preview = getStreamPreviewState(stream)
  return preview.kind === 'ready' ? buildYouTubeEmbedUrl(preview.videoId) : null
}
```

- [ ] **Step 3: Run the existing helper test again**

Run:

```bash
cd ~/Documents/Work/youtube_translation/.worktrees/stream-preview-youtube-embed/frontend
npm test -- --runInBand src/app/dashboard/streaming/__tests__/preview.test.ts
```

Expected: PASS, confirming the component scaffolding did not break the helper contract.

- [ ] **Step 4: Commit the preview panel**

```bash
cd ~/Documents/Work/youtube_translation/.worktrees/stream-preview-youtube-embed
git add frontend/src/app/dashboard/streaming/preview.ts frontend/src/app/dashboard/streaming/components/StreamPreviewPanel.tsx
git commit -m "feat: add reusable stream preview panel"
```

---

### Task 3: Add failing StreamsList interaction tests

**Files:**
- Modify: `frontend/src/app/dashboard/streaming/components/__tests__/StreamsList.test.tsx`
- Modify: `frontend/src/app/dashboard/streaming/components/StreamsList.tsx`

- [ ] **Step 1: Extend the test translation fixture with preview strings**

```ts
const translations: Record<string, string> = {
  // existing keys...
  'streams.preview.title': 'Live preview',
  'streams.preview.badge': 'YouTube preview',
  'streams.preview.latencyHint': 'Preview may lag behind live output by a few seconds',
  'streams.preview.pendingTitle': 'YouTube preview is not ready yet',
  'streams.preview.pendingDescription': 'The stream may already be live, but YouTube has not exposed the video link yet.',
}
```

- [ ] **Step 2: Add the failing interaction tests**

```ts
  it('opens an inline preview for a ready live stream', () => {
    renderList([
      createStream({
        id: 'stream-preview-ready',
        name: 'Ready preview',
        status: 'running',
        provider_status: 'live',
        provider_video_id: 'abc123xyz',
      }),
    ])

    fireEvent.click(screen.getByText('Ready preview'))

    expect(screen.getByTitle('Live preview')).toBeInTheDocument()
    expect(screen.getByTitle('Live preview')).toHaveAttribute(
      'src',
      'https://www.youtube.com/embed/abc123xyz?autoplay=1&mute=1&playsinline=1&rel=0',
    )
  })

  it('shows a pending state when the stream is live but youtube has not exposed a video id', () => {
    renderList([
      createStream({
        id: 'stream-preview-pending',
        name: 'Pending preview',
        status: 'running',
        provider_status: 'unknown',
        provider_video_id: null,
      }),
    ])

    fireEvent.click(screen.getByText('Pending preview'))

    expect(screen.getByText('YouTube preview is not ready yet')).toBeInTheDocument()
    expect(screen.queryByTitle('Live preview')).not.toBeInTheDocument()
  })

  it('keeps only one preview open at a time', () => {
    renderList([
      createStream({ id: 'stream-a', name: 'First stream', status: 'running', provider_video_id: 'aaa111' }),
      createStream({ id: 'stream-b', name: 'Second stream', status: 'running', provider_video_id: 'bbb222' }),
    ])

    fireEvent.click(screen.getByText('First stream'))
    expect(screen.getByTitle('Live preview')).toHaveAttribute('src', expect.stringContaining('aaa111'))

    fireEvent.click(screen.getByText('Second stream'))
    expect(screen.getByTitle('Live preview')).toHaveAttribute('src', expect.stringContaining('bbb222'))
    expect(screen.queryByText('First stream')).toBeInTheDocument()
  })

  it('does not toggle preview when stop is clicked', () => {
    const onStopStream = jest.fn()
    renderList(
      [
        createStream({
          id: 'stream-stop',
          name: 'Stop stream',
          status: 'running',
          provider_video_id: 'abc123xyz',
        }),
      ],
      { onStopStream },
    )

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))

    expect(onStopStream).toHaveBeenCalledWith('stream-stop')
    expect(screen.queryByTitle('Live preview')).not.toBeInTheDocument()
  })
```

- [ ] **Step 3: Run the focused list test and verify it fails**

Run:

```bash
cd ~/Documents/Work/youtube_translation/.worktrees/stream-preview-youtube-embed/frontend
npm test -- --runInBand src/app/dashboard/streaming/components/__tests__/StreamsList.test.tsx
```

Expected: FAIL because `StreamsList` does not yet render or manage any preview state.

- [ ] **Step 4: Commit the failing test expansion**

```bash
cd ~/Documents/Work/youtube_translation/.worktrees/stream-preview-youtube-embed
git add frontend/src/app/dashboard/streaming/components/__tests__/StreamsList.test.tsx
git commit -m "test: cover inline stream preview interactions"
```

---

### Task 4: Implement the inline preview flow and locale copy

**Files:**
- Modify: `frontend/src/app/dashboard/streaming/components/StreamsList.tsx`
- Modify: `frontend/src/messages/en/streaming.json`
- Modify: `frontend/src/messages/uk/streaming.json`
- Modify: `frontend/src/messages/ru/streaming.json`

- [ ] **Step 1: Add single-open preview state inside `StreamsList`**

Near the existing component state:

```ts
  const [openPreviewStreamId, setOpenPreviewStreamId] = useState<string | null>(null)
```

- [ ] **Step 2: Import the preview helpers and panel**

At the top of the file:

```ts
import { StreamPreviewPanel } from './StreamPreviewPanel'
import {
  getStreamPreviewEmbedUrl,
  getStreamPreviewState,
} from '../preview'
```

- [ ] **Step 3: Wire row click behavior with event boundaries**

Inside the row render, derive the preview state and row clickability:

```ts
                      const previewState = getStreamPreviewState(stream)
                      const previewEmbedUrl = getStreamPreviewEmbedUrl(stream)
                      const isPreviewOpen = openPreviewStreamId === stream.id
                      const canTogglePreview = previewState.kind !== 'unavailable'

                      const handleTogglePreview = () => {
                        if (!canTogglePreview) return
                        setOpenPreviewStreamId((current) => (current === stream.id ? null : stream.id))
                      }

                      const stopRowToggle: React.MouseEventHandler<HTMLElement> = (event) => {
                        event.stopPropagation()
                      }
```

Use them on the article shell and the action buttons:

```tsx
                        <motion.article
                          // existing props...
                          onClick={canTogglePreview ? handleTogglePreview : undefined}
                          role={canTogglePreview ? 'button' : undefined}
                          tabIndex={canTogglePreview ? 0 : undefined}
                          onKeyDown={
                            canTogglePreview
                              ? (event) => {
                                  if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault()
                                    handleTogglePreview()
                                  }
                                }
                              : undefined
                          }
                        >
```

and for the button cluster:

```tsx
                            <div
                              className="flex items-center gap-2 xl:flex-col xl:items-end"
                              onClick={stopRowToggle}
                              onKeyDown={(event) => event.stopPropagation()}
                            >
```

- [ ] **Step 4: Mount the preview panel only for the active row**

Below the main card body, before closing `motion.article`:

```tsx
                          {isPreviewOpen && previewState.kind !== 'unavailable' ? (
                            <StreamPreviewPanel
                              title={t('streams.preview.title')}
                              badge={t('streams.preview.badge')}
                              latencyHint={t('streams.preview.latencyHint')}
                              pendingTitle={t('streams.preview.pendingTitle')}
                              pendingDescription={t('streams.preview.pendingDescription')}
                              embedUrl={previewEmbedUrl}
                              state={previewState.kind}
                            />
                          ) : null}
```

- [ ] **Step 5: Add the new locale copy**

Add this block under each locale’s `streams` section:

```json
"preview": {
  "title": "Live preview",
  "badge": "YouTube preview",
  "latencyHint": "Preview may lag behind live output by a few seconds",
  "pendingTitle": "YouTube preview is not ready yet",
  "pendingDescription": "The stream may already be live, but YouTube has not exposed the video link yet."
}
```

Use these Ukrainian and Russian translations:

```json
"preview": {
  "title": "Попередній перегляд",
  "badge": "YouTube preview",
  "latencyHint": "Попередній перегляд може відставати від ефіру на кілька секунд",
  "pendingTitle": "YouTube preview ще не готовий",
  "pendingDescription": "Стрім уже може бути в ефірі, але YouTube ще не віддав video link."
}
```

```json
"preview": {
  "title": "Предпросмотр",
  "badge": "YouTube preview",
  "latencyHint": "Предпросмотр может отставать от эфира на несколько секунд",
  "pendingTitle": "YouTube preview ещё не готов",
  "pendingDescription": "Стрим уже может идти, но YouTube ещё не отдал video link."
}
```

- [ ] **Step 6: Run focused verification for preview behavior**

Run:

```bash
cd ~/Documents/Work/youtube_translation/.worktrees/stream-preview-youtube-embed/frontend
npm test -- --runInBand src/app/dashboard/streaming/__tests__/preview.test.ts src/app/dashboard/streaming/components/__tests__/StreamsList.test.tsx
npm run i18n:check
```

Expected: PASS for the helper tests, StreamsList interaction tests, and i18n consistency.

- [ ] **Step 7: Commit the preview UI**

```bash
cd ~/Documents/Work/youtube_translation/.worktrees/stream-preview-youtube-embed
git add frontend/src/app/dashboard/streaming/preview.ts frontend/src/app/dashboard/streaming/components/StreamPreviewPanel.tsx frontend/src/app/dashboard/streaming/components/StreamsList.tsx frontend/src/app/dashboard/streaming/components/__tests__/StreamsList.test.tsx frontend/src/messages/en/streaming.json frontend/src/messages/uk/streaming.json frontend/src/messages/ru/streaming.json
git commit -m "feat: add inline youtube stream preview"
```

---

### Task 5: Fix the collapsed sidebar go-live icon alignment

**Files:**
- Create: `frontend/src/components/layout/__tests__/Sidebar.test.tsx`
- Modify: `frontend/src/components/layout/Sidebar.tsx`
- Modify: `frontend/src/app/globals.css`

- [ ] **Step 1: Write the failing sidebar regression test**

```tsx
import { render, screen } from '@testing-library/react'

import { Sidebar } from '../Sidebar'

jest.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
}))

describe('Sidebar go-live CTA', () => {
  it('marks the go-live link as collapsed when the sidebar is collapsed', () => {
    render(<Sidebar collapsed onToggle={jest.fn()} />)

    expect(screen.getByRole('link', { name: /Почати трансляцію/i })).toHaveClass('is-collapsed')
  })
})
```

- [ ] **Step 2: Run the sidebar test to verify it fails**

Run:

```bash
cd ~/Documents/Work/youtube_translation/.worktrees/stream-preview-youtube-embed/frontend
npm test -- --runInBand src/components/layout/__tests__/Sidebar.test.tsx
```

Expected: FAIL because the CTA does not yet receive a collapsed-specific class.

- [ ] **Step 3: Update the sidebar structure for stable icon-only rendering**

Change the go-live link and collapse button to use stable SVG icons and an explicit collapsed class:

```tsx
import { ChevronLeft, ChevronRight, Radio } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

// ...

        <Link
          href="/dashboard/streaming?new=1"
          className={cn('nav-go-live', collapsed && 'is-collapsed')}
        >
          <span className="nav-icon" aria-hidden="true">
            <Radio className="h-5 w-5" />
          </span>
          <span className="nav-txt">Почати трансляцію</span>
        </Link>

// ...

        <button type="button" className="collapse-btn" onClick={onToggle}>
          <span className="nav-icon" aria-hidden="true">
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </span>
          <span className="nav-txt">Згорнути</span>
        </button>
```

- [ ] **Step 4: Center the collapsed CTA in CSS**

Add collapsed rules near the existing sidebar block:

```css
  .dashboard-v2 .nav-go-live {
    justify-content: flex-start;
  }

  .dashboard-v2 .nav-go-live.is-collapsed {
    justify-content: center;
    padding-inline: 0;
  }

  .dashboard-v2 .nav-go-live .nav-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
```

Keep the existing hidden-text rule:

```css
  .dashboard-v2 .dashboard-app.nav-collapsed .nav-go-live .nav-txt {
    display: none;
  }
```

- [ ] **Step 5: Re-run the sidebar test and do one manual browser sanity check**

Run:

```bash
cd ~/Documents/Work/youtube_translation/.worktrees/stream-preview-youtube-embed/frontend
npm test -- --runInBand src/components/layout/__tests__/Sidebar.test.tsx
```

Expected: PASS.

Manual check:

1. Open the dashboard.
2. Collapse the sidebar.
3. Confirm the `Почати трансляцію` CTA keeps the icon visually centered instead of drifting.

- [ ] **Step 6: Commit the sidebar polish**

```bash
cd ~/Documents/Work/youtube_translation/.worktrees/stream-preview-youtube-embed
git add frontend/src/components/layout/Sidebar.tsx frontend/src/components/layout/__tests__/Sidebar.test.tsx frontend/src/app/globals.css
git commit -m "fix: align collapsed sidebar go-live icon"
```

---

### Task 6: Run full feature verification and finalize

**Files:**
- Verify only

- [ ] **Step 1: Run the full frontend verification bar for this tranche**

```bash
cd ~/Documents/Work/youtube_translation/.worktrees/stream-preview-youtube-embed/frontend
npm test -- --runInBand
npm run lint
npm run type-check
npm run build
```

Expected:

- Jest PASS
- ESLint PASS
- Type-check PASS
- Next build PASS

- [ ] **Step 2: Review the diff for scope creep**

Run:

```bash
cd ~/Documents/Work/youtube_translation/.worktrees/stream-preview-youtube-embed
git diff --stat main...HEAD
git diff --check
```

Expected:

- only preview-related frontend files plus the small sidebar polish
- no whitespace or conflict-marker issues

- [ ] **Step 3: Create the final tranche commit**

```bash
cd ~/Documents/Work/youtube_translation/.worktrees/stream-preview-youtube-embed
git add frontend/src/app/dashboard/streaming frontend/src/components/layout frontend/src/app/globals.css frontend/src/messages/en/streaming.json frontend/src/messages/uk/streaming.json frontend/src/messages/ru/streaming.json
git commit -m "feat: add lightweight stream preview"
```
