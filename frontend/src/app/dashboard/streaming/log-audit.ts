export type StreamAuditEntry = {
  raw: string
  timestamp: string | null
  level: string | null
  message: string
  metadata: Record<string, unknown> | null
}

const AUDIT_PREFIX = /\s+\[audit\]\s+/i
const STREAM_STOP_MESSAGES = ['Stop requested via', 'Stream stopped via', 'Runner received']

function parseAuditMetadata(payload: string | undefined): Record<string, unknown> | null {
  if (!payload) return null

  try {
    const parsed = JSON.parse(payload) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

export function parseStreamAuditLine(line: string): StreamAuditEntry | null {
  const trimmed = (line || '').trim()
  if (!trimmed || !AUDIT_PREFIX.test(trimmed)) {
    return null
  }

  const match = trimmed.match(/^(\S+)\s+\[audit\]\s+([A-Z]+)\s+(.*?)(?:\s+(\{.*\}))?$/)
  if (!match) {
    return null
  }

  const [, timestamp, level, message, metadataPayload] = match

  return {
    raw: trimmed,
    timestamp: timestamp || null,
    level: level || null,
    message: (message || '').trim(),
    metadata: parseAuditMetadata(metadataPayload),
  }
}

export function extractStopAuditEntries(lines: string[]): StreamAuditEntry[] {
  return lines
    .map(parseStreamAuditLine)
    .filter((entry): entry is StreamAuditEntry => {
      if (!entry) return false

      const category = entry.metadata?.category
      if (category === 'stream_stop') {
        return true
      }

      return STREAM_STOP_MESSAGES.some((prefix) => entry.message.startsWith(prefix))
    })
}
