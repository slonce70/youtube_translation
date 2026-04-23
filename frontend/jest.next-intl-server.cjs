async function getLocale() {
  return 'en'
}

function setRequestLocale() {}

async function getTranslations(options) {
  const namespace = typeof options === 'object' ? options?.namespace : options
  const translate = (key, values) => {
    const fullKey = namespace ? `${namespace}.${key}` : key
    return String(fullKey).replace(/\{(\w+)\}/g, (match, name) => {
      const value = values?.[name]
      return value == null ? match : String(value)
    })
  }
  return translate
}

module.exports = {
  getLocale,
  getTranslations,
  setRequestLocale,
}
