'use client'
// Loopcast landing (Sprint 9 redesign).
// Full re-skin per Anthropic Design handoff bundle (2026-04-25).
// Brand: dark editorial · OLED-black bg · oklch(0.72 0.18 295) accent · Instrument Serif + Geist + JetBrains Mono.

import { useEffect, useState } from 'react'
import { Radio, Eye, Music } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTranslations, useMessages } from 'next-intl'
import { LoopcastDemo } from './LoopcastDemo'
import './loopcast.css'

// next-intl `t.raw()` is unavailable when messages are precompiled (e.g. in
// jsdom test runs); use `useMessages()` for raw arrays/objects instead.
type LoopcastMessages = {
  landing: {
    loopcast: {
      ticker: { items: string[] }
      proof: { days: string[] }
      testimonials: { items: Array<{ quote: string; name: string; role: string; avatar: string }> }
      faq: { items: Array<{ q: string; a: string }> }
      pricing: {
        tiers: Array<{
          name: string
          price: string
          sub: string
          tag: string | null
          list: string[]
          cta: string
          featured: boolean
        }>
      }
    }
  }
}

export function HomePageClient() {
  const router = useRouter()

  // Cursor spotlight + magnetic hover for cards/buttons
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const elements = document.querySelectorAll<HTMLElement>('.loopcast-root .lpc-step, .loopcast-root .lpc-feat')
      elements.forEach((el) => {
        const r = el.getBoundingClientRect()
        const mx = ((e.clientX - r.left) / r.width) * 100
        const my = ((e.clientY - r.top) / r.height) * 100
        el.style.setProperty('--mx', `${mx}%`)
        el.style.setProperty('--my', `${my}%`)
      })
    }
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [])

  // Scroll reveal
  useEffect(() => {
    const els = document.querySelectorAll('.loopcast-root .lpc-reveal')
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) e.target.classList.add('lpc-in')
        })
      },
      { threshold: 0.1 }
    )
    els.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])

  const goLogin = () => router.push('/login')

  return (
    <div className="loopcast-root">
      <div className="lpc-app">
        <Nav onSignIn={goLogin} onCta={goLogin} />
        <Hero onCtaMain={goLogin} />
        <UptimeTicker />
        <NoAccessBanner />
        <div className="lpc-divider lpc-reveal" />
        <HowItWorks />
        <DemoSection />
        <div className="lpc-divider lpc-reveal" />
        <Features />
        <Proof />
        <Testimonials />
        <FAQ />
        <Pricing onCta={goLogin} />
        <Closer onCtaMain={goLogin} />
        <Footer />
      </div>
    </div>
  )
}

function Nav({ onSignIn, onCta }: { onSignIn: () => void; onCta: () => void }) {
  const t = useTranslations('landing.loopcast.nav')
  const links = [
    { id: 'sec-features', label: t('features') },
    { id: 'sec-how', label: t('howItWorks') },
    { id: 'sec-demo', label: t('demo') },
    { id: 'sec-pricing', label: t('pricing') },
    { id: 'sec-faq', label: t('faq') },
  ]
  return (
    <nav className="lpc-nav">
      <div className="lpc-nav-inner">
        <a href="#" className="lpc-logo">
          <svg className="lpc-logo-mark" viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <circle cx="16" cy="16" r="12" stroke="currentColor" strokeWidth="2" />
            <circle cx="16" cy="16" r="5" fill="var(--lpc-accent)" />
            <circle cx="26" cy="6" r="3" fill="var(--lpc-accent)" />
          </svg>
          {'Loopcast'}
        </a>
        <div className="lpc-nav-links">
          {links.map((l) => (
            <a key={l.id} href={`#${l.id}`}>
              {l.label}
            </a>
          ))}
        </div>
        <div className="lpc-nav-actions">
          <button
            type="button"
            onClick={onSignIn}
            className="lpc-btn lpc-btn-ghost"
            style={{ padding: '10px 16px', fontSize: 13 }}
          >
            {t('signin')}
          </button>
          <button
            type="button"
            onClick={onCta}
            className="lpc-btn lpc-btn-primary"
            style={{ padding: '10px 18px', fontSize: 13 }}
          >
            {t('ctaMain')} {'→'}
          </button>
        </div>
      </div>
    </nav>
  )
}

function Hero({ onCtaMain }: { onCtaMain: () => void }) {
  const t = useTranslations('landing.loopcast.hero')
  return (
    <section className="lpc-hero">
      <div className="lpc-hero-glow" aria-hidden="true" />
      <div className="lpc-hero-grid lpc-wrap">
        <div className="lpc-hero-content">
          <div className="lpc-hero-pill">
            <span className="lpc-hero-pill-tag">{t('pillTag')}</span>
            {t('pillText')}
          </div>
          <h1>
            {t('titleA')}
            <em>{t('titleEm')}</em>
            {t('titleB')}
            <br />
            {t('titleC')} <em>{t('titleAnd')}</em> {t('titleD')}
          </h1>
          <p className="lpc-hero-sub">{t('subtitle')}</p>
          <div className="lpc-hero-cta">
            <button type="button" onClick={onCtaMain} className="lpc-btn lpc-btn-primary">
              {t('ctaMain')} {'→'}
            </button>
            <a href="#sec-demo" className="lpc-btn lpc-btn-ghost">
              {'▷ '}
              {t('ctaDemo')}
            </a>
          </div>
          <div className="lpc-hero-meta">
            <span>
              <span className="lpc-hero-meta-dot" />
              {t('metaLive')}
            </span>
            <span>{t('metaNoObs')}</span>
            <span>{t('metaUptime')}</span>
            <span>{t('metaAutoRecovery')}</span>
            <span>{t('metaStartTime')}</span>
          </div>
        </div>
        <HeroConsole />
      </div>
    </section>
  )
}

// Product-as-hero: a live operator console that ticks in real time so the
// landing's core promise ("it keeps running without you") is demonstrated,
// not just asserted. Replaces the heavy Three.js globe (LCP + the headline
// no longer fights a busy wireframe behind it).
function HeroConsole() {
  const t = useTranslations('landing.loopcast.hero.console')
  const [uptime, setUptime] = useState('14д 06:22:41')
  useEffect(() => {
    const base = Date.now() - (14 * 86400 + 6 * 3600 + 22 * 60 + 41) * 1000
    const pad = (n: number) => String(n).padStart(2, '0')
    const tick = () => {
      const s = Math.max(0, Math.floor((Date.now() - base) / 1000))
      const d = Math.floor(s / 86400)
      setUptime(`${d}д ${pad(Math.floor((s % 86400) / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])
  const bars = [55, 70, 48, 82, 66, 90, 72, 60, 84, 50, 76, 64]
  return (
    <div className="lpc-console" aria-hidden="true">
      <div className="lpc-console-top">
        <span className="lpc-console-live">
          <span className="lpc-console-live-dot" />
          LIVE
        </span>
        <span className="lpc-console-meta">{t('resolution')}</span>
      </div>
      <div className="lpc-console-uplabel">{t('uptimeLabel')}</div>
      <div className="lpc-console-uptime">{uptime}</div>
      <div className="lpc-console-bars">
        {bars.map((h, i) => (
          <span key={i} style={{ height: `${h}%` }} />
        ))}
      </div>
      <div className="lpc-console-row">
        <span>
          <Eye size={13} /> {t('viewersValue')} {t('viewers')}
        </span>
        <span className="lpc-console-good">{t('mbps')}</span>
      </div>
      <div className="lpc-console-track">
        <span className="lpc-console-track-ico">
          <Music size={15} />
        </span>
        <div className="lpc-console-track-text">
          <div className="lpc-console-track-name">{t('track')}</div>
          <div className="lpc-console-track-sub">{t('channel')}</div>
        </div>
        <span className="lpc-console-track-pulse">
          <Radio size={13} />
        </span>
      </div>
    </div>
  )
}

function UptimeTicker() {
  const m = useMessages() as unknown as LoopcastMessages
  const items = m.landing.loopcast.ticker.items
  const all = [
    ...items.map((label) => ({ id: `primary-${label}`, label })),
    ...items.map((label) => ({ id: `loop-${label}`, label })),
  ]
  return (
    <div className="lpc-ticker">
      <div className="lpc-ticker-track">
        {all.map((item) => (
          <span key={item.id}>
            <span className="lpc-dot" />
            {item.label}
          </span>
        ))}
      </div>
    </div>
  )
}

function NoAccessBanner() {
  const t = useTranslations('landing.loopcast.noAccess')
  return (
    <div className="lpc-wrap">
      <div className="lpc-banner-card">
        <div>
          <span className="lpc-eyebrow">{t('eyebrow')}</span>
          <h3>{t('title')}</h3>
          <p>{t('body')}</p>
        </div>
        <div className="lpc-banner-shield" aria-hidden="true">
          <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5">
            <path d="M12 2 L20 5 V12 C20 17 16 21 12 22 C8 21 4 17 4 12 V5 Z" />
            <path d="M9 12 L11 14 L15 10" />
          </svg>
        </div>
      </div>
    </div>
  )
}

function HowItWorks() {
  const t = useTranslations('landing.loopcast.howItWorks')
  const steps = [
    { n: '01', title: t('step1.title'), description: t('step1.description') },
    { n: '02', title: t('step2.title'), description: t('step2.description') },
    { n: '03', title: t('step3.title'), description: t('step3.description') },
    { n: '04', title: t('step4.title'), description: t('step4.description') },
  ]
  return (
    <section className="lpc-section lpc-wrap" id="sec-how">
      <div className="lpc-section-head">
        <span className="lpc-eyebrow">{t('eyebrow')}</span>
        <h2>
          {t('titleA')}
          <em>{t('titleEm')}</em>
        </h2>
        <p>{t('subtitle')}</p>
      </div>
      <div className="lpc-steps">
        {steps.map((s, idx) => (
          <div className="lpc-step lpc-reveal" key={s.n} style={{ transitionDelay: `${idx * 80}ms` }}>
            <div className="lpc-step-num">
              {s.n} {'—'}
            </div>
            <h4>{s.title}</h4>
            <p>{s.description}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

function DemoSection() {
  const t = useTranslations('landing.loopcast.demo')
  return (
    <section className="lpc-section lpc-wrap" id="sec-demo">
      <div className="lpc-section-head">
        <span className="lpc-eyebrow">{t('eyebrow')}</span>
        <h2>
          {t('titleA')}
          <em>{t('titleEm')}</em>
          {t('titleB')}
        </h2>
        <p>{t('subtitle')}</p>
      </div>
      <LoopcastDemo />
    </section>
  )
}

function Features() {
  const t = useTranslations('landing.loopcast.features')
  return (
    <section className="lpc-section lpc-wrap" id="sec-features">
      <div className="lpc-section-head">
        <span className="lpc-eyebrow">{t('eyebrow')}</span>
        <h2>
          {t('titleA')}
          <em>{t('titleEm')}</em>
        </h2>
        <p>{t('subtitle')}</p>
      </div>
      <div className="lpc-features">
        <div className="lpc-feat lpc-feat-1">
          <span className="lpc-eyebrow">{t('f1.eyebrow')}</span>
          <h3>
            {t('f1.titleA')}
            <em style={{ color: 'var(--lpc-accent)', fontStyle: 'italic' }}>{t('f1.titleEm')}</em>
          </h3>
          <p>{t('f1.body')}</p>
          <div className="lpc-feat-art">
            <FlowDiagram />
          </div>
        </div>
        <div className="lpc-feat lpc-feat-2">
          <span className="lpc-eyebrow">{t('f2.eyebrow')}</span>
          <h3>{t('f2.title')}</h3>
          <p>{t('f2.body')}</p>
        </div>
        <div className="lpc-feat lpc-feat-3">
          <span className="lpc-eyebrow">{t('f3.eyebrow')}</span>
          <h3>{t('f3.title')}</h3>
          <p>{t('f3.body')}</p>
        </div>
        <div className="lpc-feat lpc-feat-4">
          <span className="lpc-eyebrow">{t('f4.eyebrow')}</span>
          <h3>{t('f4.title')}</h3>
          <p>{t('f4.body')}</p>
        </div>
        <div className="lpc-feat lpc-feat-5">
          <span className="lpc-eyebrow">{t('f5.eyebrow')}</span>
          <h3>{t('f5.title')}</h3>
          <p>{t('f5.body')}</p>
        </div>
        <div className="lpc-feat lpc-feat-6">
          <span className="lpc-eyebrow">{t('f6.eyebrow')}</span>
          <h3>{t('f6.title')}</h3>
          <p>{t('f6.body')}</p>
        </div>
      </div>
    </section>
  )
}

function FlowDiagram() {
  const t = useTranslations('landing.loopcast.features.f1')
  return (
    <svg width="100%" height="100%" viewBox="0 0 600 280" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <defs>
        <linearGradient id="lpc-flow" x1="0" x2="1">
          <stop stopColor="var(--lpc-accent)" />
          <stop offset="1" stopColor="var(--lpc-teal)" />
        </linearGradient>
      </defs>
      <rect x="40" y="100" width="120" height="80" rx="8" fill="rgba(255,255,255,0.04)" stroke="var(--lpc-line-2)" />
      <text x="100" y="135" textAnchor="middle" fontFamily="var(--lpc-mono)" fontSize="11" fill="var(--lpc-fg-dim)">
        {t('diagSource')}
      </text>
      <text x="100" y="155" textAnchor="middle" fontFamily="var(--lpc-mono)" fontSize="10" fill="var(--lpc-fg)">
        {t('diagSourceFile')}
      </text>

      <rect x="220" y="80" width="160" height="120" rx="8" fill="var(--lpc-accent-soft)" stroke="var(--lpc-accent)" />
      <text x="300" y="115" textAnchor="middle" fontFamily="var(--lpc-mono)" fontSize="10" fill="var(--lpc-accent)">
        {t('diagCenter')}
      </text>
      <text x="300" y="142" textAnchor="middle" fontFamily="var(--lpc-serif)" fontSize="20" fill="var(--lpc-fg)" fontStyle="italic">
        {t('diagCenterBig')}
      </text>
      <text x="300" y="165" textAnchor="middle" fontFamily="var(--lpc-mono)" fontSize="9" fill="var(--lpc-fg-mute)">
        {t('diagCenterSub')}
      </text>
      <text x="300" y="185" textAnchor="middle" fontFamily="var(--lpc-mono)" fontSize="10" fill="var(--lpc-good)">
        {t('diagCenterLive')}
      </text>

      <rect x="440" y="100" width="120" height="80" rx="8" fill="rgba(255,255,255,0.04)" stroke="var(--lpc-line-2)" />
      <text x="500" y="135" textAnchor="middle" fontFamily="var(--lpc-mono)" fontSize="11" fill="var(--lpc-fg-dim)">
        {t('diagDest')}
      </text>
      <text x="500" y="155" textAnchor="middle" fontFamily="var(--lpc-mono)" fontSize="10" fill="var(--lpc-fg)">
        {t('diagDestSub')}
      </text>

      <line x1="160" y1="140" x2="220" y2="140" stroke="url(#lpc-flow)" strokeWidth="2" />
      <line x1="380" y1="140" x2="440" y2="140" stroke="url(#lpc-flow)" strokeWidth="2" />

      {[0, 1, 2].map((i) => (
        <circle key={i} r="4" fill="var(--lpc-accent)">
          <animate attributeName="cx" values="160;220" dur="1.6s" begin={`${i * 0.5}s`} repeatCount="indefinite" />
          <animate attributeName="cy" values="140;140" dur="1.6s" begin={`${i * 0.5}s`} repeatCount="indefinite" />
        </circle>
      ))}
      {[0, 1, 2].map((i) => (
        <circle key={`b${i}`} r="4" fill="var(--lpc-teal)">
          <animate attributeName="cx" values="380;440" dur="1.6s" begin={`${i * 0.5}s`} repeatCount="indefinite" />
          <animate attributeName="cy" values="140;140" dur="1.6s" begin={`${i * 0.5}s`} repeatCount="indefinite" />
        </circle>
      ))}
    </svg>
  )
}

function Proof() {
  const t = useTranslations('landing.loopcast.proof')
  const m = useMessages() as unknown as LoopcastMessages
  const days = m.landing.loopcast.proof.days
  const cellState = (day: number, slot: number) => {
    const s = ((day + 1) * 31 + (slot + 1) * 17) % 100
    if (s > 96) return 'bad'
    if (s > 88) return 'warn'
    return ''
  }
  const dayPct = (i: number) => (99.7 + ((i * 13) % 30) / 100).toFixed(2)
  return (
    <section className="lpc-section lpc-wrap">
      <div className="lpc-section-head">
        <span className="lpc-eyebrow">{t('eyebrow')}</span>
        <h2>
          {t('titleA')}
          <em>{t('titleEm')}</em>
        </h2>
      </div>
      <div className="lpc-proof">
        <div className="lpc-proof-card">
          <span className="lpc-eyebrow">{t('uptimeLabel')}</span>
          <h3 className="lpc-proof-big">
            {t('uptimeBig')}
            <em>{t('uptimeBigEm')}</em>
            <span style={{ fontSize: '0.5em' }}>{t('uptimeBigSuffix')}</span>
          </h3>
          <p className="lpc-proof-sub">{t('uptimeSub')}</p>
        </div>
        <div className="lpc-proof-card">
          <span className="lpc-eyebrow">{t('graphLabel')}</span>
          <div className="lpc-uptime-graph">
            {days.map((d, i) => (
              <div className="lpc-uptime-row" key={d}>
                <span className="lpc-label">{d}</span>
                <div className="lpc-uptime-bars">
                  {Array.from({ length: 48 }).map((_, j) => (
                    <i key={j} className={cellState(i, j)} />
                  ))}
                </div>
                <span className="lpc-uptime-pct">{dayPct(i)}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

type TestimonialItem = { quote: string; name: string; role: string; avatar: string }

function Testimonials() {
  const t = useTranslations('landing.loopcast.testimonials')
  const m = useMessages() as unknown as LoopcastMessages
  const items = m.landing.loopcast.testimonials.items as TestimonialItem[]
  return (
    <section className="lpc-section lpc-wrap">
      <div className="lpc-section-head">
        <span className="lpc-eyebrow">{t('eyebrow')}</span>
        <h2>
          {t('titleA')}
          <em>{t('titleEm')}</em>
          {t('titleB')}
        </h2>
      </div>
      <div className="lpc-testis">
        {items.map((it, i) => (
          <div key={it.name} className="lpc-testi lpc-reveal" style={{ transitionDelay: `${i * 80}ms` }}>
            <div className="lpc-testi-quote">{it.quote}</div>
            <div className="lpc-testi-author">
              <div className="lpc-testi-avatar" aria-hidden="true">
                {it.avatar}
              </div>
              <div>
                <div className="lpc-testi-author-name">{it.name}</div>
                <div className="lpc-testi-author-role">{it.role}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

type FaqItem = { q: string; a: string }

function FAQ() {
  const t = useTranslations('landing.loopcast.faq')
  const m = useMessages() as unknown as LoopcastMessages
  const items = m.landing.loopcast.faq.items as FaqItem[]
  const [open, setOpen] = useState(0)
  return (
    <section className="lpc-section lpc-wrap" id="sec-faq">
      <div className="lpc-section-head">
        <span className="lpc-eyebrow">{t('eyebrow')}</span>
        <h2>
          {t('titleA')}
          <em>{t('titleEm')}</em>
          {t('titleB')}
        </h2>
      </div>
      <div className="lpc-faq">
        {items.map((q, i) => (
          <div
            key={q.q}
            className={`lpc-faq-item ${open === i ? 'open' : ''}`}
            onClick={() => setOpen(open === i ? -1 : i)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setOpen(open === i ? -1 : i)
              }
            }}
          >
            <div className="lpc-faq-q">
              <span>{q.q}</span>
              <span className="lpc-faq-toggle" aria-hidden="true">
                {'+'}
              </span>
            </div>
            <div className="lpc-faq-a">{q.a}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

type PricingTier = {
  name: string
  price: string
  sub: string
  tag: string | null
  list: string[]
  cta: string
  featured: boolean
}

function Pricing({ onCta }: { onCta: () => void }) {
  const t = useTranslations('landing.loopcast.pricing')
  const m = useMessages() as unknown as LoopcastMessages
  const tiers = m.landing.loopcast.pricing.tiers as PricingTier[]
  return (
    <section className="lpc-section lpc-wrap" id="sec-pricing">
      <div className="lpc-section-head">
        <span className="lpc-eyebrow">{t('eyebrow')}</span>
        <h2>
          {t('titleA')}
          <em>{t('titleEm')}</em>
        </h2>
        <p>{t('subtitle')}</p>
      </div>
      <div className="lpc-price">
        {tiers.map((tier, idx) => (
          <div
            key={tier.name}
            className={`lpc-price-card lpc-reveal ${tier.featured ? 'featured' : ''}`}
            style={{ transitionDelay: `${idx * 80}ms` }}
          >
            {tier.tag ? <div className="lpc-badge">{tier.tag}</div> : null}
            <div className="lpc-price-name">{tier.name}</div>
            <div className="lpc-price-amt">
              <sup>{'$'}</sup>
              {tier.price}
              <sub>{tier.sub}</sub>
            </div>
            <ul className="lpc-price-list">
              {tier.list.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            <button
              type="button"
              onClick={onCta}
              className={`lpc-btn ${tier.featured ? 'lpc-btn-primary' : 'lpc-btn-ghost'}`}
              style={{ justifyContent: 'center' }}
            >
              {tier.cta} {'→'}
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}

function Closer({ onCtaMain }: { onCtaMain: () => void }) {
  const t = useTranslations('landing.loopcast.closer')
  return (
    <section className="lpc-closer">
      <div className="lpc-closer-bg" />
      <div className="lpc-closer-inner lpc-wrap">
        <h2>
          {t('titleA')}
          <em>{t('titleEm')}</em>
          <br />
          {t('titleB')}
        </h2>
        <p>{t('subtitle')}</p>
        <div className="lpc-hero-cta">
          <button type="button" onClick={onCtaMain} className="lpc-btn lpc-btn-primary">
            {t('ctaMain')} {'→'}
          </button>
          <a href="#sec-demo" className="lpc-btn lpc-btn-ghost">
            {'▷ '}
            {t('ctaDemo')}
          </a>
        </div>
      </div>
    </section>
  )
}

function Footer() {
  const t = useTranslations('landing.loopcast.footer')
  const link = (key: string) => t(`links.${key}`)
  return (
    <footer>
      <div className="lpc-wrap">
        <div className="lpc-foot">
          <div>
            <div className="lpc-logo" style={{ marginBottom: 16 }}>
              <svg className="lpc-logo-mark" viewBox="0 0 32 32" fill="none" aria-hidden="true">
                <circle cx="16" cy="16" r="12" stroke="currentColor" strokeWidth="2" />
                <circle cx="16" cy="16" r="5" fill="var(--lpc-accent)" />
              </svg>
              {'Loopcast'}
            </div>
            <p className="lpc-foot-meta">{t('tagline')}</p>
          </div>
          <div>
            <h6>{t('product')}</h6>
            <a href="#sec-features">{link('features')}</a>
            <a href="#sec-pricing">{link('pricing')}</a>
            <a href="#sec-demo">{link('demo')}</a>
            <a href="#">{link('api')}</a>
          </div>
          <div>
            <h6>{t('resources')}</h6>
            <a href="#">{link('docs')}</a>
            <a href="#">{link('streamKeyGuide')}</a>
            <a href="#">{link('status')}</a>
            <a href="#">{link('changelog')}</a>
          </div>
          <div>
            <h6>{t('company')}</h6>
            <a href="#">{link('about')}</a>
            <a href="#">{link('contact')}</a>
            <a href="#">{link('privacy')}</a>
            <a href="#">{link('terms')}</a>
          </div>
        </div>
        <div className="lpc-foot-bottom">
          <span>{t('copyright')}</span>
          <span>{t('version')}</span>
        </div>
      </div>
    </footer>
  )
}
