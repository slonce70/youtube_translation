import { defineConfig } from '@playwright/test'

const tusdUrl = process.env.NEXT_PUBLIC_TUSD_URL ?? 'http://localhost:1080'

process.env.NEXT_PUBLIC_TUSD_URL = tusdUrl

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000',
  },
})
