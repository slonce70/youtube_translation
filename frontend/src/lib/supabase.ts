import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'

const DEV_BYPASS = process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === '1'
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

if (!isSupabaseConfigured && !DEV_BYPASS) {
  throw new Error('Missing Supabase environment variables')
}

const projectRef = isSupabaseConfigured
  ? new URL(supabaseUrl as string).host.split('.')[0]
  : 'dev-auth'
const SUPABASE_STORAGE_KEY = `sb-${projectRef}-auth-token`

const SESSION_COOKIE_NAME = 'sb-session'
let cachedSession: Session | null = null

// Auth ready state management to prevent race conditions
let isAuthReady = DEV_BYPASS
let authReadyResolve: (() => void) | null = null
const authReadyPromise = new Promise<void>((resolve) => {
  authReadyResolve = resolve
  if (DEV_BYPASS) {
    resolve()
  }
})

const createBypassClient = (): SupabaseClient => {
  const noop = () => {}
  return {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: noop } } }),
      signUp: async () => ({ data: { user: null, session: null }, error: null }),
      signInWithPassword: async () => ({ data: { user: null, session: null }, error: null }),
      signOut: async () => ({ error: null }),
      getUser: async () => ({ data: { user: null }, error: null }),
    },
  } as unknown as SupabaseClient
}

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl as string, supabaseAnonKey as string, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : createBypassClient()

function setAuthCookies(session: Session | null) {
  if (DEV_BYPASS) return
  if (typeof document === 'undefined') return

  // Позначаємо наявність активної сесії без збереження чутливих токенів у cookies
  const expire = session?.expires_at
    ? new Date(session.expires_at * 1000)
    : new Date(Date.now() + 60 * 60 * 1000)

  if (session?.access_token) {
    document.cookie = `${SESSION_COOKIE_NAME}=1; Path=/; Expires=${expire.toUTCString()}; SameSite=Strict`
  } else {
    document.cookie = `${SESSION_COOKIE_NAME}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Strict`
  }

  // Скидаємо застарілі cookies з токенами, якщо вони залишились
  document.cookie = `sb-access-token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Strict`
  document.cookie = `sb-refresh-token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Strict`
}

if (isSupabaseConfigured) {
  // Initialize auth and mark as ready
  supabase.auth.getSession().then(({ data }) => {
    setAuthCookies(data.session ?? null)
    cachedSession = data.session ?? null

    // Mark auth as ready after initial session load
    if (!isAuthReady) {
      isAuthReady = true
      authReadyResolve?.()
    }
  })

  supabase.auth.onAuthStateChange((_event, session) => {
    setAuthCookies(session)
    cachedSession = session ?? null

    // Ensure auth is marked ready on any state change
    if (!isAuthReady) {
      isAuthReady = true
      authReadyResolve?.()
    }
  })
}

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

async function readTokenFromStorage(): Promise<string | null> {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const stored = window.localStorage.getItem(SUPABASE_STORAGE_KEY)
    if (!stored) {
      return null
    }

    const parsed = JSON.parse(stored)
    const accessToken =
      parsed?.currentSession?.access_token ??
      parsed?.session?.access_token ??
      parsed?.access_token

    if (typeof accessToken === 'string' && accessToken.length > 0) {
      cachedSession = cachedSession ?? ({ access_token: accessToken } as Session)
      return accessToken
    }
  } catch (error) {
    console.warn('[supabase] Failed to read persisted session token', error)
  }

  return null
}

export async function getAccessToken(maxRetries = 3): Promise<string | null> {
  if (DEV_BYPASS) {
    return null
  }
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
    return readTokenFromStorage()
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

export async function refreshAccessToken(): Promise<string | null> {
  if (DEV_BYPASS) {
    return null
  }

  try {
    const { data, error } = await supabase.auth.refreshSession()
    if (error) {
      console.warn('[supabase] Failed to refresh session', error)
      return null
    }

    cachedSession = data.session ?? null
    setAuthCookies(data.session ?? null)
    return data.session?.access_token ?? null
  } catch (error) {
    console.warn('[supabase] Failed to refresh session', error)
    return null
  }
}

export async function clearAuthSession(): Promise<void> {
  if (DEV_BYPASS) {
    return
  }

  try {
    await supabase.auth.signOut()
  } catch (error) {
    console.warn('[supabase] Failed to sign out', error)
  } finally {
    cachedSession = null
    setAuthCookies(null)
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(SUPABASE_STORAGE_KEY)
    }
  }
}

export async function isAuthenticated(): Promise<boolean> {
  if (DEV_BYPASS) {
    return true
  }
  await waitForAuth()
  const { data: { session } } = await supabase.auth.getSession()
  return !!session
}
