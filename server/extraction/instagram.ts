import type { H3Event } from 'h3'
import { readJsonBody } from './body.ts'
import { fail } from './errors.ts'
import { askGemini, INSTAGRAM_PROMPT, type GeminiConfig, type Part } from './gemini.ts'
import { parseExtraction, type ExtractedRecipe } from './recipe.ts'
import { httpUrl, MAX_URL_LENGTH } from './url.ts'
import { askFetcher, type FetcherConfig } from './website.ts'

// instagram.com/p/…, /reel/…, /tv/…, and the /{user}/p/… a share can produce.
// Only the shortcode goes on to the fetcher, which is what keeps the caller
// from naming any other host.
const HOSTS = new Set(['instagram.com', 'www.instagram.com', 'm.instagram.com'])
const POST_PATH = /^\/(?:[\w.]+\/)?(?:p|reels?|tv)\/([\w-]{5,64})\/?$/

/** The shortcode of an Instagram post link, or null for anything else. */
export function instagramShortcode(value: unknown): string | null {
  const url = httpUrl(value)
  if (!url) return null
  const parsed = new URL(url)
  return HOSTS.has(parsed.hostname) ? POST_PATH.exec(parsed.pathname)?.[1] ?? null : null
}

export function validateInstagramUrl(body: unknown): string {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw fail(400, 'Expected a JSON object with a "url" property.')
  }
  const { url } = body as { url?: unknown }
  if (typeof url !== 'string') throw fail(400, 'Expected "url" to be a string.')
  if (url.length > MAX_URL_LENGTH) throw fail(413, `Recipe URLs are limited to ${MAX_URL_LENGTH} characters.`)
  const shortcode = instagramShortcode(url)
  if (!shortcode) throw fail(400, 'Expected "url" to be a link to an Instagram post.')
  return shortcode
}

export async function readExtractionInstagram(event: H3Event): Promise<string> {
  return validateInstagramUrl(await readJsonBody(event))
}

type Image = { mimeType: string, data: string }
const isImage = (value: unknown): value is Image =>
  typeof (value as Image | null)?.mimeType === 'string'
  && (value as Image).mimeType.startsWith('image/')
  && typeof (value as Image).data === 'string'

/**
 * The Instagram modality. The fetcher reads the post; the model reads its
 * caption and images together, in one call, because these recipes are
 * routinely split across the two.
 */
export async function extractInstagram(
  shortcode: string,
  config: GeminiConfig & FetcherConfig,
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): Promise<{ recipe: ExtractedRecipe }> {
  const post = await askFetcher('/instagram', { shortcode }, config, fetcher)
  if (!Array.isArray(post.images) || !post.images.every(isImage)) {
    throw fail(502, 'The recipe fetcher returned a malformed post.', post)
  }

  const caption = typeof post.caption === 'string' && post.caption.trim() ? post.caption : null
  // Each its own part, never interpolated into the instructions: a caption is
  // whatever its author wrote, including things that read like instructions.
  const parts: Part[] = [
    ...(caption ? [{ type: 'text' as const, text: caption }] : []),
    ...post.images.map(image => ({ type: 'image' as const, data: image.data, mime_type: image.mimeType })),
  ]
  if (!parts.length) throw fail(422, 'No recipe could be found in that post.')

  const draft = await askGemini(parts, INSTAGRAM_PROMPT, config, fetcher)
  return {
    recipe: parseExtraction(draft, {
      type: 'instagram',
      url: httpUrl(post.url) ?? `https://www.instagram.com/p/${shortcode}/`,
      author: typeof post.author === 'string' && post.author.trim() ? post.author.trim().slice(0, 300) : null,
      retrievedAt: new Date().toISOString(),
    }),
  }
}
