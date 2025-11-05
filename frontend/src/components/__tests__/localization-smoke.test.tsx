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
})
