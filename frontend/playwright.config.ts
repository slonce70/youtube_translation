import { defineConfig } from '@playwright/test'

const tusdUrl = process.env.NEXT_PUBLIC_TUSD_URL ?? 'http://localhost:1080'
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000'
const usesManagedLocalServer = process.env.PLAYWRIGHT_BASE_URL === undefined

process.env.NEXT_PUBLIC_TUSD_URL = tusdUrl

if (!usesManagedLocalServer && process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === '1') {
  throw new Error(
    'PLAYWRIGHT_BASE_URL points at an existing server, but NEXT_PUBLIC_DEV_BYPASS_AUTH=1. ' +
      'Restart the server with NEXT_PUBLIC_DEV_BYPASS_AUTH=0 or unset PLAYWRIGHT_BASE_URL.'
  )
}

export default defineConfig({
  testDir: './e2e',
  expect: {
    timeout: 15_000,
  },
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
        timeout: 120_000,
      }
    : undefined,
})
