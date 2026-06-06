/** @jest-environment node */

import path from 'node:path'
import { createRequire } from 'node:module'

describe('next config', () => {
  it('keeps build-time lint disabled because lint is an explicit CI gate', () => {
    const frontendDir = path.resolve(__dirname, '../../..')
    const requireFromTest = createRequire(import.meta.url)
    const config = requireFromTest(path.join(frontendDir, 'next.config.js'))

    expect(config.eslint).toMatchObject({
      ignoreDuringBuilds: true,
    })
  })
})
