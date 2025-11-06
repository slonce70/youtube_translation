import { createClient, type Session } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

const SESSION_COOKIE_NAME = 'sb-session'

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
