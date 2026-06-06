/** @jest-environment node */

import { execFileSync } from 'node:child_process'
import path from 'node:path'

describe('playwright config', () => {
  const frontendDir = path.resolve(__dirname, '../../..')

  function loadConfig(options: { playwrightBaseUrl?: string; devBypass?: string } = {}) {
    const script = `
      const config = require('./playwright.config.ts').default;
      process.stdout.write(JSON.stringify({
        baseURL: config.use?.baseURL ?? null,
        expectTimeout: config.expect?.timeout ?? null,
        webServer: config.webServer ?? null
      }));
    `

    const env = { ...process.env }
    delete env.PLAYWRIGHT_BASE_URL
    delete env.NEXT_PUBLIC_DEV_BYPASS_AUTH
    if (options.playwrightBaseUrl !== undefined) {
      env.PLAYWRIGHT_BASE_URL = options.playwrightBaseUrl
    }
    if (options.devBypass !== undefined) {
      env.NEXT_PUBLIC_DEV_BYPASS_AUTH = options.devBypass
    }

    const output = execFileSync(process.execPath, ['-e', script], {
      cwd: frontendDir,
      env,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    return JSON.parse(output) as {
      baseURL: string | null
      expectTimeout: number | null
      webServer: {
        command?: string
        url?: string
        reuseExistingServer?: boolean
        timeout?: number
      } | null
    }
  }

  it('starts a local web server when no base URL is provided', () => {
    const config = loadConfig()

    expect(config.baseURL).toBe('http://127.0.0.1:3000')
    expect(config.expectTimeout).toBe(15_000)
    expect(config.webServer).toMatchObject({
      command: expect.stringMatching(/npm run dev/),
      env: expect.objectContaining({
        NEXT_PUBLIC_DEV_BYPASS_AUTH: '0',
      }),
      url: 'http://127.0.0.1:3000',
      reuseExistingServer: true,
      timeout: 120_000,
    })
  })

  it('does not manage a web server when an explicit base URL is provided', () => {
    const config = loadConfig({ playwrightBaseUrl: 'http://example.com' })

    expect(config.baseURL).toBe('http://example.com')
    expect(config.webServer).toBeNull()
  })

  it('fails fast when an explicit base URL is paired with dev auth bypass', () => {
    expect(() =>
      loadConfig({ playwrightBaseUrl: 'http://example.com', devBypass: '1' })
    ).toThrow(/NEXT_PUBLIC_DEV_BYPASS_AUTH=1/)
  })
})
