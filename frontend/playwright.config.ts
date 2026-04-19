import { defineConfig } from '@playwright/test'

const tusdUrl = process.env.NEXT_PUBLIC_TUSD_URL ?? 'http://localhost:1080'
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000'
const usesManagedLocalServer = process.env.PLAYWRIGHT_BASE_URL === undefined

process.env.NEXT_PUBLIC_TUSD_URL = tusdUrl

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL,
  },
  webServer: usesManagedLocalServer
    ? {
        command: 'npm run dev -- --hostname 127.0.0.1 --port 3000',
        env: {
          ...process.env,
          NEXT_PUBLIC_DEV_BYPASS_AUTH: '0',
        },
        url: baseURL,
        reuseExistingServer: true,
      }
    : undefined,
})
