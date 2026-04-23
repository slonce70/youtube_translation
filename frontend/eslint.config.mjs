import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { FlatCompat } from '@eslint/eslintrc'
import js from '@eslint/js'
import i18next from 'eslint-plugin-i18next'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
})

const i18nRuleConfig = [
  'warn',
  {
    mode: 'jsx-text-only',
    words: {
      exclude: [
        '[0-9!-/:-@[-`{-~]+',
        '[A-Z_-]+',
        '^#[0-9A-Fa-f]+$',
        '•',
        '·',
      ],
    },
    'jsx-attributes': {
      exclude: [
        'className',
        'styleName',
        'style',
        'type',
        'key',
        'id',
        'width',
        'height',
        'fill',
        'stroke',
        'd',
        'viewBox',
        'aria-label',
        'aria-hidden',
        'aria-labelledby',
        'role',
        'data-testid',
      ],
    },
  },
]

const config = [
  {
    ignores: [
      '.next/**',
      'out/**',
      'node_modules/**',
      'coverage/**',
      'test-results/**',
      'playwright-report/**',
      'dist/**',
      'build/**',
      'public/**',
    ],
  },
  ...compat.extends('next/core-web-vitals'),
  {
    files: ['src/app/**/*.{ts,tsx}', 'src/components/**/*.{ts,tsx}'],
    plugins: { i18next },
    rules: {
      'i18next/no-literal-string': i18nRuleConfig,
    },
  },
  {
    files: [
      'src/app/**/*.{test,spec}.{ts,tsx}',
      'src/components/**/*.{test,spec}.{ts,tsx}',
      'src/**/*.test.{ts,tsx}',
      'src/**/__tests__/**/*.{ts,tsx}',
    ],
    rules: {
      'i18next/no-literal-string': 'off',
    },
  },
]

export default config
