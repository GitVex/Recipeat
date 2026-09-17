import type { H3Event } from 'h3'
import { readJsonBody } from './body.ts'
import { fail } from './errors.ts'
import { parseExtraction, type ExtractedRecipe, type RecipeSource } from './recipe.ts'

// Long enough for the service's own ten-second page fetch plus CRF inference
// over the lines it finds, and short enough that a browser is not left hanging.
// No model runs on this path, which is why it is not the text pipeline's five
// minutes.
const REQUEST_TIMEOUT_MS = 60_000

export const MAX_URL_LENGTH = 2048

export type FetcherConfig = { fetcherBaseUrl: string }

// A detail from the fetcher is a message we wrote, and it names the host the
// caller asked for rather than anything of ours — so unlike Ollama's response
// bodies it is safe to pass on, capped in case that ever stops being true.
const MAX_DETAIL_LENGTH = 200
// 415 means the URL served something that is not a page. That is a problem
// with what the caller asked for, not with the request they made, so it must
// not reach them as a content-type error about their own body.
const STATUS = new Map([[413, 413], [415, 422], [422, 422], [504, 504]])

export function validateUrl(body: unknown): string {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw fail(400, 'Expected a JSON object with a "url" property.')
  }
  const { url } = body as { url?: unknown }
  if (typeof url !== 'string') throw fail(400, 'Expected "url" to be a string.')
  if (url.length > MAX_URL_LENGTH) throw fail(413, `Recipe URLs are limited to ${MAX_URL_LENGTH} characters.`)
  const web = webUrl(url.trim())
  if (!web) throw fail(400, 'Expected "url" to be an http or https address.')
  return web
}

export async function readExtractionUrl(event: H3Event): Promise<string> {
  return validateUrl(await readJsonBody(event))
}

/**
 * The URL, normalized, or null. Only http and https: the service fetches
 * whatever it is handed, and a page's own canonical link is as untrusted as
 * anything else it says.
 */
function webUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_URL_LENGTH) return null
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return null
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null
}

/**
 * "4 servings", "Makes 12", "1 loaf" — the first number is the count. The
 * wording is the site's own and cannot be relied on beyond that; anything
 * unusable leaves the recipe without a portion count, which is allowed.
 */
function portionsOf(yields: unknown): number | null {
  if (typeof yields !== 'string') return null
  const found = /\d+(?:[.,]\d+)?/.exec(yields)
  if (!found) return null
  const value = Number(found[0].replace(',', '.'))
  return Number.isFinite(value) && value > 0 ? value : null
}

async function askFetcher(
  url: string,
  config: FetcherConfig,
  fetcher: typeof globalThis.fetch,
): Promise<Record<string, unknown>> {
  // Trailing slashes are trimmed rather than resolved away, so a base URL
  // carrying a path prefix survives.
  const base = `${config.fetcherBaseUrl.replace(/[/]+$/, '')}/fetch`

  let response: Response
  try {
    response = await fetcher(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    const name = (error as Error | undefined)?.name
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw fail(504, 'That page took too long to read.', error)
    }
    if (error instanceof TypeError) throw fail(502, 'Could not connect to the recipe fetcher.', error)
    throw fail(502, 'The extraction service is unavailable.', error)
  }

  if (!response.ok) {
    const detail = await response.json().then(body => (body as { detail?: unknown })?.detail).catch(() => null)
    const message = typeof detail === 'string' && detail.trim()
      ? detail.slice(0, MAX_DETAIL_LENGTH)
      : 'That page could not be read.'
    throw fail(STATUS.get(response.status) ?? 502, message, detail ?? `HTTP ${response.status}`)
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch (error) {
    throw fail(502, 'The recipe fetcher returned a malformed response.', error)
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw fail(502, 'The recipe fetcher did not return a recipe object.', payload)
  }
  return payload as Record<string, unknown>
}

/**
 * The website modality. No model runs here: the fetcher reads the page's
 * structured data and segments its ingredient lines, so this only renames what
 * differs from a draft and records where the recipe came from. Validation and
 * normalization below it are the same ones the text pipeline uses.
 */
export async function extractWebsite(
  url: string,
  config: FetcherConfig,
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): Promise<{ recipe: ExtractedRecipe }> {
  const page = await askFetcher(url, config, fetcher)

  // An ingredient already arrives shaped like a draft's, which is the point of
  // the service naming its fields after the ones the model is asked for.
  const draft = {
    title: page.title,
    source_lang: page.language,
    portions: portionsOf(page.yields),
    ingredients: page.ingredients,
    steps: page.steps,
  }

  const source: RecipeSource = {
    type: 'website',
    // The page's canonical link where it declares a usable one. It is the
    // better key to dedupe on, and it is also a string the page chose, so it
    // is checked like any other.
    url: webUrl(page.canonicalUrl) ?? url,
    author: typeof page.author === 'string' && page.author.trim()
      ? page.author.trim().slice(0, 300)
      : null,
    retrievedAt: new Date().toISOString(),
  }

  return { recipe: parseExtraction(draft, source) }
}
