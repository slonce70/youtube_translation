import type uk from '../messages/uk'

type Messages = typeof uk

declare module 'next-intl' {
  interface IntlMessages extends Messages {}
}

