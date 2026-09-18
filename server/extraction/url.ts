// Long enough for a real recipe URL carrying tracking parameters, short enough
// that nothing can hand us an unbounded string to store.
export const MAX_URL_LENGTH = 2048

/**
 * A web address, normalized, or null. Only http and https: these are stored and
 * later rendered as links, and the ones a page supplies for itself are as
 * untrusted as anything else it says.
 */
export function httpUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_URL_LENGTH) return null
  let parsed: URL
  try {
    parsed = new URL(value.trim())
  } catch {
    return null
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null
}
