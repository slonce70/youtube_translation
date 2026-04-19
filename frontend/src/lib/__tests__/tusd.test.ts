import { resolveTusEndpoint } from '../tusd'

describe('resolveTusEndpoint', () => {
  it('falls back to /files/ when the env value is empty', () => {
    expect(resolveTusEndpoint('')).toBe('/files/')
    expect(resolveTusEndpoint(undefined)).toBe('/files/')
  })

  it('appends /files/ to a base origin', () => {
    expect(resolveTusEndpoint('http://localhost:1080')).toBe('http://localhost:1080/files/')
    expect(resolveTusEndpoint('https://tusd.example.com/')).toBe('https://tusd.example.com/files/')
  })

  it('preserves a single /files/ suffix when already provided', () => {
    expect(resolveTusEndpoint('http://localhost:1080/files')).toBe('http://localhost:1080/files/')
    expect(resolveTusEndpoint('http://localhost:1080/files/')).toBe('http://localhost:1080/files/')
  })
})
