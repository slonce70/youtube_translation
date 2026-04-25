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

describe('HomePageClient landing', () => {
  beforeAll(() => {
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: () => ({
        clearRect: jest.fn(),
        beginPath: jest.fn(),
        arc: jest.fn(),
        fill: jest.fn(),
        stroke: jest.fn(),
        fillRect: jest.fn(),
        moveTo: jest.fn(),
        lineTo: jest.fn(),
        createRadialGradient: () => ({ addColorStop: jest.fn() }),
        createLinearGradient: () => ({ addColorStop: jest.fn() }),
        setTransform: jest.fn(),
      }),
    })

    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: jest.fn().mockImplementation((query: string) => ({
        matches: query.includes('prefers-reduced-motion') ? false : false,
        media: query,
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      })),
    })
  })

  beforeEach(() => {
    pushMock.mockReset()
  })

  it('renders the immersive hero and routes CTA clicks to login', () => {
    const heroTitle = enMessages.landing.hero.title
    const healthDescription = enMessages.landing.hero.panel.healthDescription
    const primaryCta = enMessages.landing.hero.primaryCTA

    render(
      <NextIntlClientProvider locale="en" messages={enMessages as unknown as AbstractIntlMessages}>
        <HomePageClient />
      </NextIntlClientProvider>
    )

    expect(screen.getByRole('heading', { name: heroTitle })).toBeInTheDocument()
    expect(screen.getByText(healthDescription)).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: primaryCta })[0])

    expect(pushMock).toHaveBeenCalledWith('/login')
  })
})
