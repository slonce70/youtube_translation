import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Topbar } from '../Topbar'

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
  }),
}))

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => {
    const messages: Record<string, string> = {
      'brand.name': 'Studio',
      'profile.fallbackName': 'Користувач',
      'profile.accountSettings': 'Налаштування облікового запису',
      'profile.managePlan': 'Керувати тарифом',
      'profile.signOut': 'Вийти',
    }
    return messages[key] ?? key
  },
}))

jest.mock('sonner', () => ({
  toast: {
    info: jest.fn(),
  },
}))

describe('Topbar', () => {
  it('uses a semantic search button without nesting a textbox', () => {
    render(
      <Topbar
        userName="Developer"
        userEmail="dev@example.com"
        liveCount={0}
        onOpenPalette={jest.fn()}
        onSignOut={jest.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Відкрити пошук команд' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Сповіщення' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('closes the user menu with Escape regardless of current focus', async () => {
    const user = userEvent.setup()

    render(
      <Topbar
        userName="Developer"
        userEmail="dev@example.com"
        liveCount={0}
        onOpenPalette={jest.fn()}
        onSignOut={jest.fn()}
      />,
    )

    const menuButton = screen.getByRole('button', { name: 'Відкрити меню користувача Developer' })
    await user.click(menuButton)

    expect(screen.getByRole('menu', { name: 'Меню користувача' })).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('menu', { name: 'Меню користувача' })).not.toBeInTheDocument()
  })
})
