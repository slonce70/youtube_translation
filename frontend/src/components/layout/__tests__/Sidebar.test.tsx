import { render, screen } from '@testing-library/react'

import { Sidebar } from '../Sidebar'

jest.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
}))

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => {
    const messages: Record<string, string> = {
      'sidebar.goLive': 'Почати трансляцію',
      'sidebar.goLiveSub': 'Швидкий запуск live',
      'sidebar.main': 'Головне',
      'sidebar.statusOnline': 'Studio online',
      'sidebar.statusReady': 'Готово до ефіру',
      'sidebar.collapse': 'Згорнути',
      'sidebar.collapseLabel': 'Згорнути навігацію',
      'sidebar.expandLabel': 'Розгорнути навігацію',
      'sidebar.expandTitle': 'Розгорнути',
      'sidebar.items.dashboard.label': 'Дашборд',
      'sidebar.items.dashboard.sub': 'Огляд системи',
      'sidebar.items.streaming.label': 'Трансляції',
      'sidebar.items.streaming.sub': 'Live та канали',
      'sidebar.items.library.label': 'Файли',
      'sidebar.items.library.sub': 'Медіа й плейлисти',
      'sidebar.items.schedule.label': 'Розклад',
      'sidebar.items.schedule.sub': 'Запуски ефірів',
      'sidebar.items.plans.label': 'Тарифи',
      'sidebar.items.plans.sub': 'Ліміти та апгрейд',
      'sidebar.items.profile.label': 'Налаштування',
      'sidebar.items.profile.sub': 'Акаунт і канали',
    }
    return messages[key] ?? key
  },
}))

describe('Sidebar go-live CTA', () => {
  it('marks the go-live link as collapsed when the sidebar is collapsed', () => {
    render(<Sidebar collapsed onToggle={jest.fn()} />)

    expect(screen.getByRole('link', { name: /Почати трансляцію/i })).toHaveClass('is-collapsed')
  })
})
