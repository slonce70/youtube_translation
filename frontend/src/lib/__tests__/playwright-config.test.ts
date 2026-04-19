/** @jest-environment node */

import { execFileSync } from 'node:child_process'
import path from 'node:path'

describe('playwright config', () => {
  const frontendDir = path.resolve(__dirname, '../../..')

  function loadConfig(playwrightBaseUrl?: string) {
    const script = `
      const config = require('./playwright.config.ts').default;
      process.stdout.write(JSON.stringify({
        baseURL: config.use?.baseURL ?? null,
        webServer: config.webServer ?? null
      }));
    `

    const output = execFileSync(process.execPath, ['-e', script], {
      cwd: frontendDir,
      env: {
        ...process.env,
        ...(playwrightBaseUrl === undefined
          ? {}
          : { PLAYWRIGHT_BASE_URL: playwrightBaseUrl }),
      },
      encoding: 'utf-8',
    })

    return JSON.parse(output) as {
      baseURL: string | null
      webServer: {
        command?: string
        url?: string
        reuseExistingServer?: boolean
      } | null
    }
  }

  it('starts a local web server when no base URL is provided', () => {
    const config = loadConfig()

    expect(config.baseURL).toBe('http://127.0.0.1:3000')
    expect(config.webServer).toMatchObject({
      command: expect.stringMatching(/npm run dev/),
      env: expect.objectContaining({
        NEXT_PUBLIC_DEV_BYPASS_AUTH: '0',
      }),
      url: 'http://127.0.0.1:3000',
      reuseExistingServer: true,
    })
  })

  it('does not manage a web server when an explicit base URL is provided', () => {
    const config = loadConfig('http://example.com')

    expect(config.baseURL).toBe('http://example.com')
    expect(config.webServer).toBeNull()
  })
})
