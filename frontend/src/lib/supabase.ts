import { createBrowserClient } from '@supabase/ssr'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { getSupabaseConfig } from './supabase/config'

const { supabaseUrl, supabaseKey } = getSupabaseConfig()
const isTestEnv = process.env.NODE_ENV === 'test'

const createTestClient = () => ({
  auth: {
    getSession: async () => ({ data: { session: null }, error: null }),
    getUser: async () => ({ data: { user: null }, error: null }),
    onAuthStateChange: () => ({
      data: { subscription: { unsubscribe: () => {} } },
    }),
    signOut: async () => ({ error: null }),
    signInWithPassword: async () => ({ data: { session: null }, error: null }),
    signUp: async () => ({ data: { user: null, session: null }, error: null }),
    updateUser: async () => ({ data: { user: null }, error: null }),
  },
})

let cachedSession: Session | null = null

// Auth ready state management to prevent race conditions
let isAuthReady = false
let authReadyResolve: (() => void) | null = null
const authReadyPromise = new Promise<void>((resolve) => {
  authReadyResolve = resolve
})

export const supabase = isTestEnv
  ? (createTestClient() as ReturnType<typeof createBrowserClient>)
  : createBrowserClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })

// Initialize auth and mark as ready
supabase.auth.getSession().then(({ data }: { data: { session: Session | null } }) => {
  cachedSession = data.session ?? null
  
  // Mark auth as ready after initial session load
  if (!isAuthReady) {
    isAuthReady = true
    authReadyResolve?.()
  }
})

supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
  cachedSession = session ?? null
  
  // Ensure auth is marked ready on any state change
  if (!isAuthReady) {
    isAuthReady = true
    authReadyResolve?.()
  }
})

/**
 * Wait for Supabase auth to be fully initialized.
 * This prevents race conditions where API calls are made before the auth token is available.
 * 
 * @returns Promise that resolves when auth is ready
 */
export async function waitForAuth(): Promise<void> {
  if (isAuthReady) {
    return Promise.resolve()
  }
  return authReadyPromise
}

export async function getAccessToken(maxRetries = 3): Promise<string | null> {
  await waitForAuth()

  const attempt = async (): Promise<string | null> => {
    if (cachedSession?.access_token) {
      return cachedSession.access_token
    }
    const { data: { session } } = await supabase.auth.getSession()
    cachedSession = session ?? cachedSession
    if (session?.access_token) {
      return session.access_token
    }
    return null
  }

  let token = await attempt()
  if (token) {
    return token
  }

  for (let retry = 0; retry < maxRetries; retry += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250 * (retry + 1)))
    token = await attempt()
    if (token) {
      return token
    }
  }

  console.warn('[supabase] Access token unavailable after retries')
  return null
}

export async function isAuthenticated(): Promise<boolean> {
  await waitForAuth()
  const { data: { session } } = await supabase.auth.getSession()
  return !!session
}
