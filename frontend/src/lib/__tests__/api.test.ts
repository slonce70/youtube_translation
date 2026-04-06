import { api } from '../api'

jest.mock('../supabase', () => ({
  getAccessToken: jest.fn(),
  waitForAuth: jest.fn().mockResolvedValue(undefined),
}))

const { getAccessToken } = jest.requireMock('../supabase') as {
  getAccessToken: jest.Mock
}

describe('api client', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    global.fetch = jest.fn()
  })

  it('includes bearer token and POST when starting stream', async () => {
    getAccessToken.mockResolvedValue('secret-token')
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ stream_id: 'abc', status: 'running' }),
    })

    const result = await api.streams.start('abc')

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/streams/abc/start'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer secret-token',
          'Content-Type': 'application/json',
        }),
      })
    )
    expect(result).toEqual({ stream_id: 'abc', status: 'running' })
  })

  it('maps admin user filters to API query params', async () => {
    getAccessToken.mockResolvedValue(null)
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [],
    })

    await api.admin.users.list({ is_suspended: true, limit: 10 })

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/admin/users'),
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      })
    )

    const url = new URL((global.fetch as jest.Mock).mock.calls[0][0], 'http://localhost')
    expect(url.searchParams.get('suspended')).toBe('true')
    expect(url.searchParams.get('limit')).toBe('10')
  })

  it('throws detailed error when response is not ok', async () => {
    getAccessToken.mockResolvedValue('token')
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ detail: 'Bad Request' }),
    })

    await expect(api.assets.list()).rejects.toThrow('Bad Request')
  })

  it('requests upload status from the dedicated ingest endpoint', async () => {
    getAccessToken.mockResolvedValue('token')
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ upload_id: 'upload-1', status: 'validating' }),
    })

    const result = await api.assets.getUploadStatus('upload-1')

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/assets/uploads/upload-1'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer token',
          'Content-Type': 'application/json',
        }),
      })
    )
    expect(result).toEqual({ upload_id: 'upload-1', status: 'validating' })
  })

  it('maps youtube oauth start params to the API query string', async () => {
    getAccessToken.mockResolvedValue('token')
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ auth_url: 'https://accounts.google.com/o/oauth2/v2/auth?state=test' }),
    })

    const result = await api.youtube.oauthStart({
      redirect_origin: 'http://localhost:3000',
      redirect_path: '/dashboard/profile',
    })

    const url = new URL((global.fetch as jest.Mock).mock.calls[0][0], 'http://localhost')
    expect(url.pathname).toContain('/api/youtube/oauth/start')
    expect(url.searchParams.get('redirect_origin')).toBe('http://localhost:3000')
    expect(url.searchParams.get('redirect_path')).toBe('/dashboard/profile')
    expect(result).toEqual({
      auth_url: 'https://accounts.google.com/o/oauth2/v2/auth?state=test',
    })
  })
})
