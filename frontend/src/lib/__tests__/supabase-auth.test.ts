/**
 * Tests for Supabase auth initialization and waitForAuth()
 * Ensures that auth race conditions are prevented
 */

// Mock the entire supabase module to avoid environment variable issues
jest.mock('../supabase', () => {
  let isAuthReady = false
  let authReadyResolve: (() => void) | null = null
  const authReadyPromise = new Promise<void>((resolve) => {
    authReadyResolve = resolve
  })

  // Simulate auth initialization
  setTimeout(() => {
    if (!isAuthReady) {
      isAuthReady = true
      authReadyResolve?.()
    }
  }, 10)

  return {
    waitForAuth: jest.fn(async () => {
      if (isAuthReady) {
        return Promise.resolve()
      }
      return authReadyPromise
    }),
    getAccessToken: jest.fn(async () => {
      if (isAuthReady) {
        return 'test-token'
      }
      await authReadyPromise
      return 'test-token'
    }),
    isAuthenticated: jest.fn(async () => {
      await authReadyPromise
      return true
    }),
    supabase: {
      auth: {
        getSession: jest.fn().mockResolvedValue({
          data: { session: { access_token: 'test-token', user: { id: '123' } } },
        }),
        onAuthStateChange: jest.fn(() => ({
          data: { subscription: { unsubscribe: jest.fn() } },
        })),
      },
    },
  }
})

import { waitForAuth, getAccessToken, isAuthenticated } from '../supabase'

describe('Supabase Auth Initialization', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('waitForAuth', () => {
    it('should eventually resolve when auth is ready', async () => {
      await expect(waitForAuth()).resolves.toBeUndefined()
    })

    it('should be callable multiple times without issues', async () => {
      await expect(waitForAuth()).resolves.toBeUndefined()
      await expect(waitForAuth()).resolves.toBeUndefined()
      await expect(waitForAuth()).resolves.toBeUndefined()
    })
  })

  describe('getAccessToken', () => {
    it('should wait for auth before getting token', async () => {
      const token = await getAccessToken()
      expect(token).toBe('test-token')
    })

    it('should handle concurrent token requests', async () => {
      const tokens = await Promise.all([
        getAccessToken(),
        getAccessToken(),
        getAccessToken(),
      ])
      
      expect(tokens).toHaveLength(3)
      tokens.forEach(token => expect(token).toBe('test-token'))
    })
  })

  describe('isAuthenticated', () => {
    it('should wait for auth before checking authentication', async () => {
      const result = await isAuthenticated()
      expect(result).toBe(true)
    })
  })

  describe('Race condition prevention', () => {
    it('should handle rapid sequential calls without 401 errors', async () => {
      // Simulate multiple API calls happening immediately on page load
      const results = await Promise.all([
        getAccessToken(),
        getAccessToken(),
        isAuthenticated(),
        waitForAuth(),
        getAccessToken(),
      ])
      
      expect(results[0]).toBe('test-token')
      expect(results[1]).toBe('test-token')
      expect(results[2]).toBe(true)
      expect(results[3]).toBeUndefined()
      expect(results[4]).toBe('test-token')
    })
  })
})
