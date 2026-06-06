type StreamPreviewPanelBaseProps = {
  title: string
  badge: string
  latencyHint: string
  pendingTitle: string
  pendingDescription: string
}

type StreamPreviewPanelPendingProps = StreamPreviewPanelBaseProps & {
  state: 'pending'
}

type StreamPreviewPanelReadyProps = StreamPreviewPanelBaseProps & {
  state: 'ready'
  embedUrl: string
}

type StreamPreviewPanelProps = StreamPreviewPanelPendingProps | StreamPreviewPanelReadyProps

export function StreamPreviewPanel(props: StreamPreviewPanelProps) {
  if (props.state === 'pending') {
    const { badge, pendingTitle, pendingDescription } = props
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

  const { title, badge, latencyHint, embedUrl } = props

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
            sandbox="allow-scripts allow-same-origin allow-presentation"
            allowFullScreen
          />
        </div>
      </div>
    </div>
  )
}
