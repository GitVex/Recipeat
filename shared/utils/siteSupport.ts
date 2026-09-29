// How a website import will be read, told from its address alone. The fetcher
// has a scraper for each host on its list and falls back to a page's schema.org
// Recipe markup for every other one, so the list decides which of the two a
// link gets. Whether an unlisted page has markup is not knowable without
// fetching it, which is why the second case is worded as an attempt.
export type SiteSupport = 'supported' | 'markup'

export const SITE_HINT: Record<SiteSupport, string> = {
  supported: 'Supported: we know how to read this site.',
  markup: 'Not on the supported list, so we’ll try reading the page’s recipe markup.',
}

// The 422 for an unlisted page, in the hint's own words, so what failed is
// the thing the hint said would be tried.
export const NO_MARKUP = 'That site isn’t on the supported list, and the page has no recipe markup we could read.'

/**
 * The host as recipe-scrapers matches it: `get_host_name` drops a leading
 * `www.` and compares the rest exactly. A subdomain or a country variant is
 * supported only if it is on the list itself. `URL` has already lowercased the
 * host and dropped the port, as httpx has for the address the fetcher sees.
 * Null for anything that is not an http(s) address.
 */
export function siteHost(address: string): string | null {
  let url: URL
  try {
    url = new URL(address)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  return url.hostname.replace(/^www\./, '') || null
}

export function siteSupport(address: string, hosts: ReadonlySet<string>): SiteSupport | null {
  const host = siteHost(address)
  if (host === null) return null
  return hosts.has(host) ? 'supported' : 'markup'
}
