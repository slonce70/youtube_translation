import { createClient, type Session } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})

function setAuthCookies(session: Session | null) {
  if (typeof document === 'undefined') return

  const expireAccess = session?.expires_at
    ? new Date(session.expires_at * 1000)
    : new Date(Date.now() + 60 * 60 * 1000)

  const expireRefresh = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000) // ~60 days

  if (session?.access_token) {
    document.cookie = `sb-access-token=${session.access_token}; Path=/; Expires=${expireAccess.toUTCString()}; SameSite=Lax`
  } else {
    document.cookie = `sb-access-token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`
  }

  if (session?.refresh_token) {
    document.cookie = `sb-refresh-token=${session.refresh_token}; Path=/; Expires=${expireRefresh.toUTCString()}; SameSite=Lax`
  } else {
    document.cookie = `sb-refresh-token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`
  }
}

supabase.auth.getSession().then(({ data }) => setAuthCookies(data.session ?? null))

supabase.auth.onAuthStateChange((_event, session) => {
  setAuthCookies(session)
})

export async function getAccessToken(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ?? null
}

export async function isAuthenticated(): Promise<boolean> {
  const { data: { session } } = await supabase.auth.getSession()
  return !!session
}
