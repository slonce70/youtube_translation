'use client'

import { useTranslations } from 'next-intl'
import Link from 'next/link'

// Track 5b/D / RULE 6, 7: a first-run hand-rail. The default streaming
// page is hostile to brand-new accounts because it shows three empty
// state placeholders ("0 channels", "0 assets", "no live streams") and
// expects the operator to figure out the order. This wizard reduces
// that to one obvious next step at a time.
//
// Steps are derived from data already on the page (no extra fetch):
//   1. Add a destination channel  → /dashboard/channels
//   2. Upload at least one asset    → /dashboard/library
//   3. Create + start a stream      → opens StreamBuilderModal via ?new=1

interface EmptyStateWizardProps {
  hasChannel: boolean
  hasAsset: boolean
}

type StepStatus = 'todo' | 'done' | 'next'

interface StepDescriptor {
  key: 'channel' | 'asset' | 'stream'
  status: StepStatus
}

function computeSteps(hasChannel: boolean, hasAsset: boolean): StepDescriptor[] {
  const steps: StepDescriptor[] = [
    { key: 'channel', status: hasChannel ? 'done' : 'todo' },
    { key: 'asset', status: hasAsset ? 'done' : 'todo' },
    { key: 'stream', status: 'todo' },
  ]
  // Mark the first non-done step as "next" so we visually focus exactly
  // one action.
  const next = steps.find((step) => step.status === 'todo')
  if (next) next.status = 'next'
  return steps
}

const HREF: Record<StepDescriptor['key'], string> = {
  channel: '/dashboard/channels',
  asset: '/dashboard/library',
  // Track 5b/F: deep-linkable create-stream route (replaces the
  // ?new=1 modal-on-page query path).
  stream: '/dashboard/streams/new',
}

export function EmptyStateWizard({ hasChannel, hasAsset }: EmptyStateWizardProps) {
  const t = useTranslations('streaming.wizard')
  const steps = computeSteps(hasChannel, hasAsset)

  return (
    <section
      style={{
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: '32px 28px',
        display: 'flex',
        flexDirection: 'column',
        gap: 24,
        background: 'var(--bg-2)',
      }}
    >
      <header style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span
          style={{
            fontFamily: 'var(--font-mono-app)',
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: '0.18em',
            color: 'var(--txt-3)',
          }}
        >
          {t('eyebrow')}
        </span>
        <h2
          style={{
            margin: 0,
            fontFamily: 'var(--font-display)',
            fontSize: 28,
            lineHeight: 1.1,
            color: 'var(--txt)',
          }}
        >
          {t('title')}
        </h2>
        <p style={{ margin: 0, color: 'var(--txt-2)', fontSize: 14, lineHeight: 1.5, maxWidth: 560 }}>
          {t('description')}
        </p>
      </header>

      <ol style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 0, margin: 0, listStyle: 'none' }}>
        {steps.map((step, index) => {
          const numLabel = String(index + 1).padStart(2, '0')
          const isDone = step.status === 'done'
          const isNext = step.status === 'next'
          return (
            <li
              key={step.key}
              style={{
                display: 'grid',
                gridTemplateColumns: '36px 1fr auto',
                alignItems: 'center',
                gap: 16,
                padding: '14px 16px',
                border: `1px solid ${isNext ? 'var(--indigo)' : 'var(--border)'}`,
                borderRadius: 12,
                background: isNext ? 'rgba(255,255,255,0.04)' : 'transparent',
                opacity: step.status === 'todo' ? 0.55 : 1,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  border: `1px solid ${isDone ? 'var(--green)' : 'var(--border-lt)'}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: 'var(--font-mono-app)',
                  fontSize: 12,
                  color: isDone ? 'var(--green)' : 'var(--txt-2)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {isDone ? '✓' : numLabel}
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: 'var(--txt)' }}>
                  {t(`steps.${step.key}.title`)}
                </span>
                <span style={{ fontSize: 13, color: 'var(--txt-3)' }}>
                  {t(`steps.${step.key}.description`)}
                </span>
              </div>
              {isDone ? (
                <span
                  style={{
                    fontFamily: 'var(--font-mono-app)',
                    fontSize: 11,
                    textTransform: 'uppercase',
                    letterSpacing: '0.16em',
                    color: 'var(--green)',
                  }}
                >
                  {t('done')}
                </span>
              ) : isNext ? (
                <Link
                  href={HREF[step.key]}
                  style={{
                    appearance: 'none',
                    background: 'var(--txt)',
                    color: '#0a0a0f',
                    border: '1px solid rgba(255,255,255,0.1)',
                    fontFamily: 'var(--font-mono-app)',
                    fontSize: 11,
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    padding: '8px 16px',
                    borderRadius: 999,
                    textDecoration: 'none',
                    boxShadow: '0 10px 30px -10px oklch(0.72 0.20 295 / 0.45)',
                  }}
                >
                  {t(`steps.${step.key}.cta`)}
                </Link>
              ) : (
                <span
                  style={{
                    fontFamily: 'var(--font-mono-app)',
                    fontSize: 11,
                    textTransform: 'uppercase',
                    letterSpacing: '0.16em',
                    color: 'var(--txt-3)',
                  }}
                >
                  {t('locked')}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
