export function resolveTusEndpoint(rawBase?: string | null): string {
  const base = rawBase?.trim().replace(/\/+$/, '')

  if (!base) {
    return '/files/'
  }

  if (base.endsWith('/files')) {
    return `${base}/`
  }

  return `${base}/files/`
}
