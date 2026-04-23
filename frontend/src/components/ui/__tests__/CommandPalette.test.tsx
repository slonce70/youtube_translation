import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CommandPalette } from '../CommandPalette'

const mockPush = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}))

jest.mock('next-intl', () => ({
  useTranslations: (namespace: string) => (key: string) => {
    const messages: Record<string, string> = {
      'nav.commandPalette.label': 'Палітра команд',
      'nav.commandPalette.placeholder': 'Перейдіть до… наприклад «Файли» або «Трансляції»',
      'nav.commandPalette.emptyTitle': 'Нічого не знайдено',
      'nav.commandPalette.emptySub': 'Спробуйте інший запит.',
      'nav.commands.defaultGroup': 'Команди',
    }
    return messages[`${namespace}.${key}`] ?? key
  },
}))

function TestIcon({ className }: { className?: string }) {
  return <svg className={className} aria-hidden="true" />
}

const items = [
  {
    id: 'dashboard',
    icon: TestIcon,
    label: 'Дашборд',
    sub: 'Головна панель',
    group: 'Навігація',
    href: '/dashboard',
  },
  {
    id: 'library',
    icon: TestIcon,
    label: 'Файли',
    sub: 'Бібліотека та плейлисти',
    group: 'Навігація',
    href: '/dashboard/library',
  },
  {
    id: 'streaming',
    icon: TestIcon,
    label: 'Трансляції',
    sub: 'Канали, live та архів',
    group: 'Навігація',
    href: '/dashboard/streaming',
  },
]

describe('CommandPalette', () => {
  beforeAll(() => {
    window.HTMLElement.prototype.scrollIntoView = jest.fn()
  })

  beforeEach(() => {
    mockPush.mockClear()
  })

  it('exposes an accessible dialog name and keyboard-selects the active command', async () => {
    const user = userEvent.setup()
    const onClose = jest.fn()

    render(<CommandPalette open onClose={onClose} items={items} />)

    expect(screen.getByRole('dialog', { name: 'Палітра команд' })).toBeInTheDocument()

    const input = screen.getByPlaceholderText('Перейдіть до… наприклад «Файли» або «Трансляції»')
    input.focus()
    await user.keyboard('{ArrowDown}{Enter}')

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(mockPush).toHaveBeenCalledWith('/dashboard/library')
  })

  it('filters commands before running the active result', async () => {
    const user = userEvent.setup()
    const onClose = jest.fn()

    render(<CommandPalette open onClose={onClose} items={items} />)

    const input = screen.getByPlaceholderText('Перейдіть до… наприклад «Файли» або «Трансляції»')
    input.focus()
    await user.type(input, 'транс')
    await user.keyboard('{Enter}')

    expect(mockPush).toHaveBeenCalledWith('/dashboard/streaming')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes from the search field with Escape once', async () => {
    const user = userEvent.setup()
    const onClose = jest.fn()

    render(<CommandPalette open onClose={onClose} items={items} />)

    const secondInput = screen.getByPlaceholderText('Перейдіть до… наприклад «Файли» або «Трансляції»')
    secondInput.focus()
    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
