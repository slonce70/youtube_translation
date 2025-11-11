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
      'http://localhost:8000/api/streams/abc/start/',
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
      expect.stringContaining('/admin/users/'),
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      })
    )

    const url = new URL((global.fetch as jest.Mock).mock.calls[0][0])
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
})
