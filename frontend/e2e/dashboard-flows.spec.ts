import { expect, test, type Page } from '@playwright/test'

import { resolveTusEndpoint } from '../src/lib/tusd'

type ApiMockOptions = {
  tusdUrl?: string
}

async function setupApiMocks(page: Page, options: ApiMockOptions = {}) {
  const tusdUrl = options.tusdUrl ?? process.env.NEXT_PUBLIC_TUSD_URL ?? 'http://localhost:1080'
  const expectedEndpoint = resolveTusEndpoint(tusdUrl)
  const expectedPath = new URL(expectedEndpoint, tusdUrl).pathname
  const expectedLocation = new URL(expectedEndpoint, tusdUrl).toString()

  await page.route('**/*', async (route) => {
    const request = route.request()
    const { pathname } = new URL(request.url())

    if (pathname === expectedPath) {
      if (request.method() !== 'POST') {
        return route.fulfill({ status: 405, body: 'Method Not Allowed' })
      }

      return route.fulfill({
        status: 201,
        headers: {
          Location: expectedLocation,
          'Tus-Resumable': '1.0.0',
          'Upload-Offset': '0',
        },
        body: '',
      })
    }

    if (pathname.startsWith(`${expectedPath}files/`)) {
      return route.fulfill({
        status: 400,
        body: 'Unexpected doubled tus path',
      })
    }

    return route.fulfill({ status: 404, body: 'Not mocked' })
  })
}

test.describe('dashboard API mock contract', () => {
  test('keeps tus uploads on a single /files/ segment', async ({ page }) => {
    await setupApiMocks(page)

    const status = await page.evaluate(async () => {
      const response = await fetch('http://localhost:1080/files/', {
        method: 'POST',
      })

      return response.status
    })

    expect(status).toBe(201)
  })

  test('rejects doubled /files/files/ tus paths', async ({ page }) => {
    await setupApiMocks(page)

    const status = await page.evaluate(async () => {
      const response = await fetch('http://localhost:1080/files/files/', {
        method: 'POST',
      })

      return response.status
    })

    expect(status).toBe(400)
  })
})
