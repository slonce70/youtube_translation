import { fireEvent, render, screen } from '@testing-library/react'
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl'

import { HomePageClient } from '../HomePageClient'
import enMessages from '@/messages/en'

const pushMock = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
  }),
}))

jest.mock('../../LanguageSwitcher', () => ({
  LanguageSwitcher: () => <div data-testid="language-switcher">language switcher</div>,
}))

jest.mock('../../DarkModeToggle', () => ({
  DarkModeToggle: () => <div data-testid="dark-mode-toggle">theme toggle</div>,
}))

jest.mock('../Hero3DGlobe', () => ({
  Hero3DGlobe: () => <div data-testid="hero-3d-globe" />,
}))

describe('HomePageClient — Loopcast landing', () => {
  beforeAll(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: jest.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      })),
    })
    // Stub IntersectionObserver for scroll-reveal effect.
    class MockIO {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    // @ts-expect-error: jsdom does not provide IntersectionObserver
    window.IntersectionObserver = MockIO
  })

  beforeEach(() => {
    pushMock.mockReset()
  })

  it('renders the Loopcast hero copy and routes the primary CTA to /login', () => {
    const subtitle = enMessages.landing.loopcast.hero.subtitle
    const ctaMain = enMessages.landing.loopcast.hero.ctaMain
    const noAccessTitle = enMessages.landing.loopcast.noAccess.title

    render(
      <NextIntlClientProvider locale="en" messages={enMessages as unknown as AbstractIntlMessages}>
        <HomePageClient />
      </NextIntlClientProvider>
    )

    // Hero subtitle is rendered exactly once.
    expect(screen.getByText(subtitle)).toBeInTheDocument()
    // "No channel access" trust banner survives the redesign.
    expect(screen.getByText(noAccessTitle)).toBeInTheDocument()

    // Primary CTA appears in nav, hero, and closer — at least one must route to /login.
    const ctaButtons = screen.getAllByRole('button', { name: new RegExp(ctaMain) })
    expect(ctaButtons.length).toBeGreaterThan(0)
    fireEvent.click(ctaButtons[0])
    expect(pushMock).toHaveBeenCalledWith('/login')
  })
})
