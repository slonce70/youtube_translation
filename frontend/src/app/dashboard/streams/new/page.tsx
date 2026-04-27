'use client'

// Track 5b/F: deep-linkable replacement for `?new=1` modal-on-page flow.
// The 502-LOC StreamBuilderModal is reused as-is (open always = true,
// onClose navigates back to the streaming list) so this route ships
// the URL benefits without a 502-LOC rewrite of the form internals:
//
//   • Bookmarkable / shareable "create stream" URL.
//   • Browser back works (closes the page → returns to list).
//   • "Add channel" inside the builder navigates to /channels and the
//     operator can hit back to land here again instead of losing a
//     half-filled modal in a portal.
//
// The legacy `?new=1` query handling on /dashboard/streaming still works
// for older bookmarks and for the inline "+ Нова трансляція" button on
// the list page; both paths converge on the same StreamBuilderModal.

import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

import { useDashboardContext } from '../../dashboard-context'
import { useStreamingPageData } from '../../streaming/hooks/useStreamingPageData'

const StreamBuilderModal = dynamic(
  () =>
    import('../../streaming/components/StreamBuilderModal').then(
      (mod) => mod.StreamBuilderModal,
    ),
  { ssr: false },
)

export default function NewStreamPage() {
  const router = useRouter()
  const tStreaming = useTranslations('streaming.page')
  const tDetail = useTranslations('streaming.detail')
  const streamingToasts = useTranslations('streaming.toasts')
  const { user, quota } = useDashboardContext()

  const {
    assets,
    audioCollections,
    destinations,
    formatLimitValue,
    isLoadingAssets,
    isLoadingAudioCollections,
    isLoadingDestinations,
    isLoadingVideoCollections,
    streams,
    videoCollections,
  } = useStreamingPageData({
    userId: user?.id,
    quota,
    tStreaming,
  })

  const handleClose = () => {
    router.push('/dashboard/streaming')
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <Link
            href="/dashboard/streaming"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              color: 'var(--txt-3)',
              textDecoration: 'none',
              fontFamily: 'var(--font-mono-app)',
              fontSize: 11,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
            }}
          >
            <ArrowLeft className="h-3 w-3" />
            {tDetail('back')}
          </Link>
        </div>
      </div>

      <StreamBuilderModal
        open
        onClose={handleClose}
        onOpenChannelForm={() => router.push('/dashboard/channels')}
        destinations={destinations}
        isLoadingDestinations={isLoadingDestinations}
        assets={assets}
        isLoadingAssets={isLoadingAssets}
        videoCollections={videoCollections}
        isLoadingVideoCollections={isLoadingVideoCollections}
        audioCollections={audioCollections}
        isLoadingAudioCollections={isLoadingAudioCollections}
        quota={quota}
        streams={streams}
        t={tStreaming}
        streamingToasts={streamingToasts}
        formatLimitValue={formatLimitValue}
      />
    </div>
  )
}
