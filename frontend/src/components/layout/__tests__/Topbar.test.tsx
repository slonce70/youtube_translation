import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Topbar } from '../Topbar'

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
  }),
}))

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) => {
    const messages: Record<string, string> = {
      'brand.name': 'Studio',
      'search.openCommand': 'Відкрити пошук команд',
      'search.placeholder': 'Пошук або ⌘K…',
      'notifications.label': 'Сповіщення',
      'notifications.empty': 'Немає нових сповіщень',
      'profile.fallbackName': 'Користувач',
      'profile.accountSettings': 'Налаштування облікового запису',
      'profile.accountSub': 'Профіль, канали, ключі',
      'profile.managePlan': 'Керувати тарифом',
      'profile.planSub': 'Ліміти та місткість',
      'profile.signOut': 'Вийти',
      'profile.signOutSub': 'Завершити сесію',
      'userMenu.open': `Відкрити меню користувача ${values?.name ?? ''}`,
      'userMenu.label': 'Меню користувача',
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
