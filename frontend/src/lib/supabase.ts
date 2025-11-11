import { createClient, type Session } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

const projectRef = new URL(supabaseUrl).host.split('.')[0]
const SUPABASE_STORAGE_KEY = `sb-${projectRef}-auth-token`

const SESSION_COOKIE_NAME = 'sb-session'
let cachedSession: Session | null = null

// Auth ready state management to prevent race conditions
let isAuthReady = false
let authReadyResolve: (() => void) | null = null
const authReadyPromise = new Promise<void>((resolve) => {
  authReadyResolve = resolve
})

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})

function setAuthCookies(session: Session | null) {
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

export async function isAuthenticated(): Promise<boolean> {
  await waitForAuth()
  const { data: { session } } = await supabase.auth.getSession()
  return !!session
}
