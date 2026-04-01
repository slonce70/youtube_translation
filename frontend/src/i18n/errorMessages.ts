type Translator = (key: string, values?: Record<string, string | number>) => string

const codeMappings: Record<string, string> = {
  over_email_send_rate_limit: 'rateLimited',
}

const messageMappings: Array<{ regex: RegExp; key: string }> = [
  { regex: /invalid login credentials/i, key: 'invalidCredentials' },
  { regex: /email not confirmed/i, key: 'emailNotConfirmed' },
  { regex: /user already registered/i, key: 'userAlreadyRegistered' },
  { regex: /password should be at least/i, key: 'passwordTooWeak' },
  { regex: /current password is incorrect/i, key: 'currentPasswordIncorrect' },
  { regex: /missing email/i, key: 'missingEmail' },
  { regex: /too many requests/i, key: 'rateLimited' },
  { regex: /over request rate limit/i, key: 'rateLimited' },
  { regex: /failed to fetch/i, key: 'networkUnavailable' },
  { regex: /networkerror/i, key: 'networkUnavailable' },
  { regex: /load failed/i, key: 'networkUnavailable' },
]

export function translateSupabaseError(error: unknown, t: Translator): string | undefined {
  if (!error) {
    return undefined
  }

  if (typeof error === 'string') {
    return matchMessage(error)
  }

  if (typeof error === 'object') {
    const maybeError = error as Record<string, unknown>
    const code = typeof maybeError.code === 'string' ? maybeError.code : undefined
    const message = typeof maybeError.message === 'string' ? maybeError.message : undefined

    if (code && codeMappings[code]) {
      return t(codeMappings[code])
    }

    if (message) {
      const mapped = matchMessage(message)
      if (mapped) {
        return mapped
      }
    }
  }

  return undefined

  function matchMessage(message: string): string | undefined {
    for (const { regex, key } of messageMappings) {
      if (regex.test(message)) {
        return t(key)
      }
    }
    return undefined
  }
}
