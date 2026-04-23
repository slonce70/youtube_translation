const React = require('react')

const IntlContext = React.createContext({
  locale: 'en',
  messages: {},
})

function getValue(messages, key) {
  return key.split('.').reduce((current, segment) => {
    if (current && Object.prototype.hasOwnProperty.call(current, segment)) {
      return current[segment]
    }
    return undefined
  }, messages)
}

function interpolate(template, values) {
  if (typeof template !== 'string') {
    return template
  }

  return template.replace(/\{(\w+)\}/g, (match, name) => {
    const value = values?.[name]
    return value == null || typeof value === 'function' ? match : String(value)
  })
}

function createTranslator(messages, namespace) {
  const translate = (key, values) => {
    const fullKey = namespace ? `${namespace}.${key}` : key
    const value = getValue(messages, fullKey)
    return interpolate(value ?? fullKey, values)
  }
  translate.rich = translate
  return translate
}

function NextIntlClientProvider({ children, locale = 'en', messages = {} }) {
  return React.createElement(
    IntlContext.Provider,
    { value: { locale, messages } },
    children,
  )
}

function useTranslations(namespace) {
  const { messages } = React.useContext(IntlContext)
  return React.useMemo(
    () => createTranslator(messages, namespace),
    [messages, namespace],
  )
}

function useLocale() {
  return React.useContext(IntlContext).locale
}

function useMessages() {
  return React.useContext(IntlContext).messages
}

module.exports = {
  NextIntlClientProvider,
  useTranslations,
  useLocale,
  useMessages,
  useFormatter: () => ({}),
}
