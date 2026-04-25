'use client'

import { useState, useEffect, type CSSProperties, type DragEvent } from 'react'
import { useTranslations } from 'next-intl'

type Track = { id: number; title: string; dur: string; tag: 'video' | 'audio' }

const initialPlaylist: Track[] = [
  { id: 1, title: 'Midnight Drive · Synthwave', dur: '4:32', tag: 'video' },
  { id: 2, title: 'Coffee Break · Lo-fi', dur: '3:18', tag: 'audio' },
  { id: 3, title: 'Tokyo Rain · Ambient', dur: '5:04', tag: 'video' },
  { id: 4, title: 'Forest Spirits · Lo-fi', dur: '3:55', tag: 'video' },
  { id: 5, title: 'Sunset Boulevard · Synthwave', dur: '4:11', tag: 'video' },
]

export function LoopcastDemo() {
  const t = useTranslations('landing.loopcast.demo')
  const [playlist, setPlaylist] = useState<Track[]>(initialPlaylist)
  const [playingIdx, setPlayingIdx] = useState(0)
  const [progress, setProgress] = useState(0)
  const [dragId, setDragId] = useState<number | null>(null)
  const [overId, setOverId] = useState<number | null>(null)
  const [bitrate, setBitrate] = useState(6420)
  const [viewers, setViewers] = useState(127)
  const [uptime, setUptime] = useState({ d: 14, h: 7, m: 42, s: 18 })

  useEffect(() => {
    const id = setInterval(() => {
      setProgress((p) => {
        const next = p + 0.3
        if (next >= 100) {
          setPlayingIdx((i) => (i + 1) % playlist.length)
          return 0
        }
        return next
      })
      setBitrate((b) => Math.max(5800, Math.min(7400, b + (Math.random() - 0.5) * 80)))
      setViewers((v) => Math.max(80, Math.min(220, v + Math.round((Math.random() - 0.5) * 4))))
      setUptime((u) => {
        const s = u.s + 1
        if (s < 60) return { ...u, s }
        const m = u.m + 1
        if (m < 60) return { ...u, m, s: 0 }
        const h = u.h + 1
        if (h < 24) return { ...u, h, m: 0, s: 0 }
        return { d: u.d + 1, h: 0, m: 0, s: 0 }
      })
    }, 100)
    return () => clearInterval(id)
  }, [playlist.length])

  const handleDragStart = (id: number) => setDragId(id)
  const handleDragOver = (e: DragEvent<HTMLDivElement>, id: number) => {
    e.preventDefault()
    setOverId(id)
  }
  const handleDrop = () => {
    if (dragId == null || overId == null || dragId === overId) {
      setDragId(null)
      setOverId(null)
      return
    }
    const next = [...playlist]
    const fromIdx = next.findIndex((x) => x.id === dragId)
    const toIdx = next.findIndex((x) => x.id === overId)
    const [moved] = next.splice(fromIdx, 1)
    next.splice(toIdx, 0, moved)
    setPlaylist(next)
    setDragId(null)
    setOverId(null)
  }
  const removeTrack = (id: number) => setPlaylist((p) => p.filter((tr) => tr.id !== id))

  const current = playlist[playingIdx] || playlist[0]
  const fmt = (n: number) => String(n).padStart(2, '0')

  const channelStats = [
    { label: t('channelStats.subscribers'), value: '124.8K', good: false },
    { label: t('channelStats.views24h'), value: '38,412', good: false },
    { label: t('channelStats.incomeMonth'), value: '$1,840', good: true },
  ]

  return (
    <div className="lpc-demo-wrap">
      <div className="lpc-demo-top">
        <div className="lpc-demo-tabs">
          <span className="lpc-demo-tab active">{t('tabs.stream')}</span>
          <span className="lpc-demo-tab">{t('tabs.library')}</span>
          <span className="lpc-demo-tab">{t('tabs.schedule')}</span>
          <span className="lpc-demo-tab">{t('tabs.settings')}</span>
        </div>
        <div className="lpc-live-chip">
          <i />
          {'LIVE · '}
          {fmt(uptime.d)}
          {'d '}
          {fmt(uptime.h)}
          {':'}
          {fmt(uptime.m)}
          {':'}
          {fmt(uptime.s)}
        </div>
      </div>

      <div className="lpc-demo-body">
        {/* Playlist */}
        <div className="lpc-demo-panel">
          <div className="lpc-panel-head">
            <h5>{t('playlist')}</h5>
            <span className="lpc-mono">{t('playlistMeta', { count: playlist.length })}</span>
          </div>
          <div className="lpc-tracklist" onDragEnd={handleDrop}>
            {playlist.map((tr, i) => (
              <div
                key={tr.id}
                draggable
                onDragStart={() => handleDragStart(tr.id)}
                onDragOver={(e) => handleDragOver(e, tr.id)}
                onDrop={handleDrop}
                className={`lpc-track ${i === playingIdx ? 'playing' : ''} ${overId === tr.id ? 'over' : ''} ${dragId === tr.id ? 'dragging' : ''}`}
              >
                <div className="lpc-track-grip" aria-hidden="true">{'⋮⋮'}</div>
                <div className="lpc-track-num">
                  {i === playingIdx ? (
                    <span className="lpc-pulse" aria-hidden="true">{'▶'}</span>
                  ) : (
                    String(i + 1).padStart(2, '0')
                  )}
                </div>
                <div className="lpc-track-info">
                  <div className="lpc-track-title">{tr.title}</div>
                  <div className="lpc-track-meta">
                    <span className={`lpc-tag lpc-tag-${tr.tag}`}>{tr.tag}</span>
                    <span>{tr.dur}</span>
                  </div>
                </div>
                <div className="lpc-track-rm" onClick={() => removeTrack(tr.id)} aria-label="remove">
                  {'×'}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Preview */}
        <div className="lpc-demo-panel">
          <div className="lpc-panel-head">
            <h5>{t('preview')}</h5>
            <span className="lpc-mono lpc-accent">{t('broadcasting')}</span>
          </div>
          <PreviewCanvas idx={playingIdx} />
          <div className="lpc-now-playing">
            <div className="lpc-now-label">{t('nowLabel')}</div>
            <div className="lpc-now-title">{current.title}</div>
            <div className="lpc-progress">
              <div className="lpc-progress-bar" style={{ width: `${progress}%` }} />
            </div>
          </div>
          <div className="lpc-stats">
            <div className="lpc-stat-chip">
              <div className="lpc-stat-label">{t('stats.bitrate')}</div>
              <div className="lpc-stat-val">
                {Math.round(bitrate)} <span>{'kb/s'}</span>
              </div>
            </div>
            <div className="lpc-stat-chip">
              <div className="lpc-stat-label">{t('stats.youtube')}</div>
              <div className="lpc-stat-val" style={{ color: 'var(--lpc-good)' }}>
                {t('stats.live')}
              </div>
            </div>
            <div className="lpc-stat-chip">
              <div className="lpc-stat-label">{t('stats.viewers')}</div>
              <div className="lpc-stat-val">{viewers}</div>
            </div>
          </div>
        </div>

        {/* Channel */}
        <div className="lpc-demo-panel">
          <div className="lpc-panel-head">
            <h5>{t('channel')}</h5>
            <span className="lpc-live-chip-sm">
              <i />
              {'LIVE'}
            </span>
          </div>
          <div className="lpc-dest-card active">
            <div className="lpc-dest-row">
              <span className="lpc-dest-icon" style={{ background: '#ff3b3b', color: '#fff' }} aria-hidden="true">
                {'▶'}
              </span>
              <span className="lpc-dest-name">{t('destName')}</span>
            </div>
            <div className="lpc-dest-key">{t('destKey')}</div>
          </div>
          {channelStats.map((s) => (
            <div key={s.label} className="lpc-channel-row">
              <span className="lpc-channel-label">{s.label}</span>
              <span
                className="lpc-channel-val"
                style={{ color: s.good ? 'var(--lpc-good)' : 'var(--lpc-fg)' }}
              >
                {s.value}
              </span>
            </div>
          ))}
          <div className="lpc-monetize-note">
            <div className="lpc-monetize-label">{t('monetizeLabel')}</div>
            <div className="lpc-monetize-text">{t('monetizeText')}</div>
          </div>
        </div>
      </div>
    </div>
  )
}

function PreviewCanvas({ idx }: { idx: number }) {
  const palettes: Array<[string, string, string]> = [
    ['#1a0d3a', '#b892ff', '#7de9d9'],
    ['#0d1a3a', '#7de9d9', '#b892ff'],
    ['#3a0d2a', '#ff8aa8', '#b892ff'],
    ['#0a2a1a', '#7df0a8', '#b892ff'],
    ['#2a1a0a', '#ffce7d', '#b892ff'],
  ]
  const [bg, c1, c2] = palettes[idx % palettes.length]
  const style: CSSProperties = {
    background: `radial-gradient(ellipse at 30% 30%, ${c2}55, transparent 60%), radial-gradient(ellipse at 70% 70%, ${c1}55, transparent 60%), ${bg}`,
  }
  return (
    <div className="lpc-preview" style={style}>
      <div className="lpc-preview-grid" />
      <div className="lpc-preview-orbs">
        <div className="lpc-orb" style={{ background: c1 }} />
        <div className="lpc-orb" style={{ background: c2, animationDelay: '-3s' }} />
      </div>
      <div className="lpc-preview-badge">{'1080p · 60fps'}</div>
    </div>
  )
}
