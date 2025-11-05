import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { defaultLocale, locales } from '@/i18n/config'

const PUBLIC_PATHS = new Set(['/', '/login'])
const COOKIE_NAME = 'NEXT_LOCALE'

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Get locale from cookie or use default
  const localeFromCookie = request.cookies.get(COOKIE_NAME)?.value
  const resolvedLocale = localeFromCookie && locales.includes(localeFromCookie as typeof locales[number])
    ? (localeFromCookie as typeof locales[number])
    : defaultLocale

  // Create response
  const response = NextResponse.next()
  
  // Set locale header for next-intl
  response.headers.set('x-next-intl-locale', resolvedLocale)
  
  // Update cookie
  response.cookies.set(COOKIE_NAME, resolvedLocale, {
    path: '/',
    sameSite: 'lax',
    maxAge: 31536000, // 1 year
  })

  // Skip auth check for public paths
  if (PUBLIC_PATHS.has(pathname)) {
    return response
  }

  // Check authentication for dashboard routes
  const isDashboardRoute = pathname.startsWith('/dashboard') || pathname.startsWith('/admin')

  if (isDashboardRoute) {
    const accessCookie = request.cookies.get('sb-access-token')
    const refreshCookie = request.cookies.get('sb-refresh-token')

    if (!accessCookie || !refreshCookie) {
      const loginUrl = request.nextUrl.clone()
      loginUrl.pathname = '/login'
      loginUrl.searchParams.set('redirect', pathname)

      const redirectResponse = NextResponse.redirect(loginUrl)
      redirectResponse.headers.set('x-next-intl-locale', resolvedLocale)
      redirectResponse.cookies.set(COOKIE_NAME, resolvedLocale, {
        path: '/',
        sameSite: 'lax',
        maxAge: 31536000,
      })

      return redirectResponse
    }
  }

  return response
}

export const config = {
  matcher: [
    // Skip all internal paths (_next, api, static files)
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)',
  ],
}
