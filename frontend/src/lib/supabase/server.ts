import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import type { CookieOptions } from '@supabase/ssr'

import { getSupabaseConfig } from './config'

export async function createSupabaseServerClient() {
  const cookieStore = await cookies()
  const { supabaseUrl, supabaseKey } = getSupabaseConfig()

  return createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
    },
  })
}

export async function createSupabaseServerActionClient() {
  const cookieStore = await cookies()
  const { supabaseUrl, supabaseKey } = getSupabaseConfig()

  return createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (
        cookiesToSet: Array<{
          name: string
          value: string
          options: CookieOptions
        }>
      ) => {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookieStore.set({
            name,
            value,
            ...options,
          } as CookieOptions & { name: string; value: string })
        })
      },
    },
  })
}
