import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider, type AbstractIntlMessages } from 'next-intl'

import { LoadingState } from '../LoadingState'
import ukMessages from '../../messages/uk'
import ruMessages from '../../messages/ru'
import enMessages from '../../messages/en'

const localeFixtures: Array<{
  locale: 'uk' | 'ru' | 'en'
  expected: string
  messages: AbstractIntlMessages
}> = [
  {
    locale: 'uk',
    expected: 'Завантаження...',
    messages: ukMessages as unknown as AbstractIntlMessages,
  },
  {
    locale: 'ru',
    expected: 'Загрузка...',
    messages: ruMessages as unknown as AbstractIntlMessages,
  },
  {
    locale: 'en',
    expected: 'Loading...',
    messages: enMessages as unknown as AbstractIntlMessages,
  },
]

describe('Localization smoke tests', () => {
  it.each(localeFixtures)('renders localized loading state for %s', ({ locale, expected, messages }) => {
    render(
      <NextIntlClientProvider locale={locale} messages={messages}>
        <LoadingState />
      </NextIntlClientProvider>
    )

    expect(screen.getByText(expected)).toBeInTheDocument()
  })

  it('respects explicit override text', () => {
    render(
      <NextIntlClientProvider locale="uk" messages={ukMessages as unknown as AbstractIntlMessages}>
        <LoadingState text="Custom text" />
      </NextIntlClientProvider>
    )

    expect(screen.getByText('Custom text')).toBeInTheDocument()
  })

  it('keeps Ukrainian provider copy localized on dashboard surfaces', () => {
    expect(ukMessages.streaming.page.provider.channelsDescription).toBe(
      'Ваші RTMPS-канали з необов’язковою прив’язкою до YouTube'
    )
    expect(ukMessages.streaming.provider.modalDescription).toContain('ключ трансляції')
    expect(ukMessages.profile.provider.title).toBe('Підключення YouTube')
    expect(ukMessages.profile.provider.emptyHint).toContain('верхня панель')
  })

  it('keeps Russian provider copy localized on dashboard surfaces', () => {
    expect(ruMessages.streaming.page.provider.channelsDescription).toBe(
      'Ваши RTMPS-каналы с необязательной привязкой к YouTube'
    )
    expect(ruMessages.streaming.provider.modalDescription).toContain('ключ трансляции')
    expect(ruMessages.profile.provider.title).toBe('Подключения YouTube')
    expect(ruMessages.profile.provider.emptyHint).toContain('верхняя строка')
  })
})
