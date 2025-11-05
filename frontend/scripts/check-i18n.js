#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

/**
 * Checks that all locale bundles share the same structure.
 * Uses the Ukrainian (uk) bundle as the source of truth.
 */

const BASE_LOCALE = 'uk'
const messagesDir = path.resolve(__dirname, '../src/messages')

function getLocaleDirectories() {
  return fs
    .readdirSync(messagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
}

function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8')
  try {
    return JSON.parse(raw)
  } catch (error) {
    throw new Error(`Failed to parse JSON at ${filePath}: ${error.message}`)
  }
}

function flattenMessages(namespace, value, result) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      const next = `${namespace}.${index}`
      flattenMessages(next, item, result)
    })
    return result
  }

  if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, nestedValue]) => {
      const next = namespace ? `${namespace}.${key}` : key
      flattenMessages(next, nestedValue, result)
    })
    return result
  }

  result.add(namespace)
  return result
}

function collectLocaleData(locale) {
  const localeDir = path.join(messagesDir, locale)
  if (!fs.existsSync(localeDir)) {
    throw new Error(`Locale directory not found: ${locale}`)
  }

  const files = fs
    .readdirSync(localeDir)
    .filter((file) => file.endsWith('.json'))
    .sort()

  const namespaces = new Map()

  files.forEach((file) => {
    const namespace = path.basename(file, '.json')
    const jsonPath = path.join(localeDir, file)
    const data = readJsonFile(jsonPath)
    const keys = flattenMessages(namespace, data, new Set())
    namespaces.set(namespace, keys)
  })

  return { locale, files: new Set(files), namespaces }
}

function diffLocale(base, candidate) {
  const missingFiles = []
  const extraFiles = []
  const missingKeys = []
  const extraKeys = []

  base.files.forEach((file) => {
    if (!candidate.files.has(file)) {
      missingFiles.push(file)
    }
  })

  candidate.files.forEach((file) => {
    if (!base.files.has(file)) {
      extraFiles.push(file)
    }
  })

  base.namespaces.forEach((baseKeys, namespace) => {
    const candidateKeys = candidate.namespaces.get(namespace) ?? new Set()

    baseKeys.forEach((key) => {
      if (!candidateKeys.has(key)) {
        missingKeys.push(key)
      }
    })

    candidateKeys.forEach((key) => {
      if (!baseKeys.has(key)) {
        extraKeys.push(key)
      }
    })
  })

  candidate.namespaces.forEach((_keys, namespace) => {
    if (!base.namespaces.has(namespace)) {
      const namespaceKeys = candidate.namespaces.get(namespace) || new Set()
      namespaceKeys.forEach((key) => {
        extraKeys.push(key)
      })
    }
  })

  return {
    missingFiles,
    extraFiles,
    missingKeys,
    extraKeys,
  }
}

function formatList(items) {
  return items.map((item) => `  - ${item}`).join('\n')
}

function main() {
  const locales = getLocaleDirectories()
  if (!locales.includes(BASE_LOCALE)) {
    console.error(`✖ Base locale "${BASE_LOCALE}" directory is missing.`)
    process.exit(1)
  }

  const base = collectLocaleData(BASE_LOCALE)

  const failures = []

  locales
    .filter((locale) => locale !== BASE_LOCALE)
    .forEach((locale) => {
      const data = collectLocaleData(locale)
      const { missingFiles, extraFiles, missingKeys, extraKeys } = diffLocale(base, data)

      if (missingFiles.length || extraFiles.length || missingKeys.length || extraKeys.length) {
        failures.push({ locale, missingFiles, extraFiles, missingKeys, extraKeys })
      }
    })

  if (failures.length === 0) {
    console.log(`✔ All locales match the ${BASE_LOCALE} source bundle.`)
    return
  }

  failures.forEach(({ locale, missingFiles, extraFiles, missingKeys, extraKeys }) => {
    console.error(`\nLocale "${locale}" has inconsistencies:`)

    if (missingFiles.length) {
      console.error(' Missing files:')
      console.error(formatList(missingFiles))
    }

    if (extraFiles.length) {
      console.error(' Extra files:')
      console.error(formatList(extraFiles))
    }

    if (missingKeys.length) {
      console.error(' Missing keys:')
      console.error(formatList(missingKeys))
    }

    if (extraKeys.length) {
      console.error(' Extra keys:')
      console.error(formatList(extraKeys))
    }
  })

  console.error('\n✖ Translation bundles are out of sync.')
  process.exit(1)
}

main()
