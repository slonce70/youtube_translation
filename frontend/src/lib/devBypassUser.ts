const DEFAULT_DEV_DISPLAY_NAME = 'Developer'
export const DEV_BYPASS_DISPLAY_NAME_STORAGE_KEY =
  'youtube-streaming.dev-bypass-display-name'

function getStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function readDevBypassDisplayName(): string {
  const storage = getStorage()
  if (!storage) {
    return DEFAULT_DEV_DISPLAY_NAME
  }

  const stored = storage.getItem(DEV_BYPASS_DISPLAY_NAME_STORAGE_KEY)?.trim()
  return stored || DEFAULT_DEV_DISPLAY_NAME
}

export function writeDevBypassDisplayName(value: string): string {
  const nextValue = value.trim() || DEFAULT_DEV_DISPLAY_NAME
  const storage = getStorage()
  storage?.setItem(DEV_BYPASS_DISPLAY_NAME_STORAGE_KEY, nextValue)
  return nextValue
}

export function clearDevBypassDisplayName(): void {
  const storage = getStorage()
  storage?.removeItem(DEV_BYPASS_DISPLAY_NAME_STORAGE_KEY)
}
