import { supportedSites } from '../../utils/extraction.ts'

// The list changes only when the fetcher is redeployed with another
// recipe-scrapers, so it is asked for once a day rather than once a dialog. A
// failure is not cached, and the next caller asks again.
const cachedSites = defineCachedFunction(
  (fetcherBaseUrl: string) => supportedSites({ fetcherBaseUrl }),
  { name: 'fetcher-sites', maxAge: 60 * 60 * 24, getKey: () => 'hosts' },
)

// No session: it is the public library's list, the same for everyone, and the
// page listing it can be read signed out.
export default defineEventHandler(async (event) => {
  const hosts = await cachedSites(useRuntimeConfig(event).fetcherBaseUrl)
  setHeader(event, 'Cache-Control', 'public, max-age=3600')
  return { hosts }
})
