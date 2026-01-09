import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

import { defaultLocale, locales } from '@/i18n/config'
import { getSupabaseConfig } from '@/lib/supabase/config'

const PUBLIC_PATHS = new Set(['/', '/login'])
const COOKIE_NAME = 'NEXT_LOCALE'
const DEV_BYPASS_AUTH = process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === '1'

function applyLocale(response: NextResponse, locale: string) {
  response.headers.set('x-next-intl-locale', locale)
  response.cookies.set(COOKIE_NAME, locale, {
    path: '/',
    sameSite: 'lax',
    maxAge: 31536000,
  })
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Get locale from cookie or use default
  const localeFromCookie = request.cookies.get(COOKIE_NAME)?.value
  const resolvedLocale = localeFromCookie && locales.includes(localeFromCookie as typeof locales[number])
    ? (localeFromCookie as typeof locales[number])
    : defaultLocale

  let response = NextResponse.next()
  applyLocale(response, resolvedLocale)

  if (DEV_BYPASS_AUTH && process.env.NODE_ENV !== 'production') {
    return response
  }

  const { supabaseUrl, supabaseKey } = getSupabaseConfig()
  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set({
            name,
            value,
            ...options,
          })
        })
      },
    },
  })

  const { data: { user } } = await supabase.auth.getUser()

  if (PUBLIC_PATHS.has(pathname)) {
    return response
  }

  const isDashboardRoute = pathname.startsWith('/dashboard') || pathname.startsWith('/admin')

  if (isDashboardRoute && !user) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = '/login'
    loginUrl.searchParams.set('redirect', pathname)

    const redirectResponse = NextResponse.redirect(loginUrl)
    applyLocale(redirectResponse, resolvedLocale)
    return redirectResponse
  }

  return response
}

export const config = {
  matcher: [
    // Skip all internal paths (_next, api, static files)
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)',
  ],
}
