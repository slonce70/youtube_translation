import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'

import { defaultLocale, locales } from '@/i18n/config'
import { getSupabaseConfig } from '@/lib/supabase/config'

const PUBLIC_PATHS = new Set(['/', '/login'])
const COOKIE_NAME = 'NEXT_LOCALE'
const DEV_BYPASS = process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === '1'

function applyLocale(response: NextResponse, resolvedLocale: string) {
  response.headers.set('x-next-intl-locale', resolvedLocale)
  response.cookies.set(COOKIE_NAME, resolvedLocale, {
    path: '/',
    sameSite: 'lax',
    maxAge: 31536000,
  })
  return response
}

function redirectToLogin(request: NextRequest, resolvedLocale: string) {
  const loginUrl = request.nextUrl.clone()
  loginUrl.pathname = '/login'
  loginUrl.searchParams.set('redirect', request.nextUrl.pathname)
  return applyLocale(NextResponse.redirect(loginUrl), resolvedLocale)
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Get locale from cookie or use default
  const localeFromCookie = request.cookies.get(COOKIE_NAME)?.value
  const resolvedLocale = localeFromCookie && locales.includes(localeFromCookie as typeof locales[number])
    ? (localeFromCookie as typeof locales[number])
    : defaultLocale

  let response = applyLocale(NextResponse.next(), resolvedLocale)

  // Skip auth check for public paths or dev bypass
  if (DEV_BYPASS || PUBLIC_PATHS.has(pathname)) {
    return response
  }

  // Check authentication for dashboard routes
  const isDashboardRoute = pathname.startsWith('/dashboard') || pathname.startsWith('/admin')

  if (!isDashboardRoute) {
    return response
  }

  const { supabaseUrl, supabaseKey } = getSupabaseConfig()
  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value)
        })

        response = applyLocale(NextResponse.next(), resolvedLocale)
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options)
        })
      },
    },
  })

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return redirectToLogin(request, resolvedLocale)
    }
  } catch {
    return redirectToLogin(request, resolvedLocale)
  }

  return response
}

export const config = {
  matcher: [
    // Skip all internal paths (_next, api, static files)
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)',
  ],
}
