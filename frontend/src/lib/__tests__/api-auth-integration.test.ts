/**
 * Integration tests for API authentication
 * Tests that API requests wait for auth to be ready
 */

// Mock environment variables before importing
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'

// Mock fetch
global.fetch = jest.fn()

// Mock supabase
jest.mock('../supabase', () => ({
  waitForAuth: jest.fn().mockResolvedValue(undefined),
  getAccessToken: jest.fn().mockResolvedValue('test-token'),
}))

import { api } from '../api'
import { waitForAuth } from '../supabase'

describe('API Authentication Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ([]),
    })
  })

  describe('API requests', () => {
    it('should wait for auth before making requests', async () => {
      await api.assets.list()
      
      // waitForAuth should be called before fetch
      expect(waitForAuth).toHaveBeenCalled()
      expect(global.fetch).toHaveBeenCalled()
      
      // Verify order: waitForAuth called before fetch
      const waitForAuthCallOrder = (waitForAuth as jest.Mock).mock.invocationCallOrder[0]
      const fetchCallOrder = (global.fetch as jest.Mock).mock.invocationCallOrder[0]
      expect(waitForAuthCallOrder).toBeLessThan(fetchCallOrder)
    })

    it('should include Bearer token in all authenticated requests', async () => {
      await api.assets.list()
      
      const fetchCall = (global.fetch as jest.Mock).mock.calls[0]
      const headers = fetchCall[1].headers
      
      expect(headers['Authorization']).toBe('Bearer test-token')
    })

    it('should handle concurrent API requests without race conditions', async () => {
      // Simulate multiple API calls happening simultaneously on page load
      await Promise.all([
        api.assets.list(),
        api.playlists.list(),
        api.destinations.list(),
      ])
      
      // waitForAuth should be called for each request
      expect(waitForAuth).toHaveBeenCalledTimes(3)
      expect(global.fetch).toHaveBeenCalledTimes(3)
      
      // All requests should have auth header
      const calls = (global.fetch as jest.Mock).mock.calls
      calls.forEach(call => {
        expect(call[1].headers['Authorization']).toBe('Bearer test-token')
      })
    })

    it('should not fail if token is not available yet', async () => {
      // Mock getAccessToken returning null (not ready yet)
      const { getAccessToken } = require('../supabase')
      ;(getAccessToken as jest.Mock).mockResolvedValueOnce(null)
      
      await api.assets.list()
      
      const fetchCall = (global.fetch as jest.Mock).mock.calls[0]
      const headers = fetchCall[1].headers
      
      // Should not have Authorization header if no token
      expect(headers['Authorization']).toBeUndefined()
    })
  })

  describe('Error handling', () => {
    it('should handle 401 errors gracefully', async () => {
      ;(global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ detail: 'Unauthorized' }),
      })
      
      await expect(api.assets.list()).rejects.toThrow()
    })
  })
})
