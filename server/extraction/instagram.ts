import { fail } from './errors.ts'
import { askGemini, INSTAGRAM_PROMPT, type GeminiConfig, type Part } from './gemini.ts'
import { parseExtraction, type ExtractedRecipe } from './recipe.ts'
import { httpUrl } from './url.ts'
import { askFetcher, extractWebsite, type FetcherConfig } from './website.ts'
import type { InstagramPostRef } from '../../shared/types/recipe.ts'

type Image = { mimeType: string, data: string }
const isImage = (value: unknown): value is Image =>
  typeof (value as Image | null)?.mimeType === 'string'
  && (value as Image).mimeType.startsWith('image/')
  && typeof (value as Image).data === 'string'

// Each costs a page read, and a caption with more than this many links is a
// list of products rather than a pointer to the recipe.
const MAX_CAPTION_LINKS = 3

// Captions are plain text, so a creator writes "www.site.com/recipe" as often
// as a full URL. Trailing punctuation is the sentence's, not the link's.
const LINK = /\b(?:https?:\/\/|www\.)[^\s<>"]+/gi
const TRAILING = /[).,!?;:'"»”’]+$/

/**
 * The web links a caption names, in order, without Instagram's own: another
 * post is not a recipe page, and following it would read Instagram again.
 */
export function captionLinks(caption: string | null): string[] {
  const links = new Set<string>()
  for (const [raw] of caption?.matchAll(LINK) ?? []) {
    const text = raw.replace(TRAILING, '')
    const url = httpUrl(/^https?:/i.test(text) ? text : `https://${text}`)
    if (!url) continue
    const host = new URL(url).hostname
    if (host === 'instagram.com' || host.endsWith('.instagram.com')) continue
    links.add(url)
    if (links.size === MAX_CAPTION_LINKS) break
  }
  return [...links]
}

/**
 * The website modality for a link to an Instagram post (#120). The fetcher
 * reads the post; then, in order, until one finds a recipe:
 *
 * 1. a page the caption links to, through the website import (#122);
 * 2. the caption and images together, through the model, in one call, because
 *    these recipes are routinely split across the two.
 *
 * Either way the source is a website source crediting the post.
 */
export async function extractInstagram(
  shortcode: string,
  config: GeminiConfig & FetcherConfig,
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): Promise<{ recipe: ExtractedRecipe }> {
  const read = await askFetcher('/instagram', { shortcode }, config, fetcher)
  if (!Array.isArray(read.images) || !read.images.every(isImage)) {
    throw fail(502, 'The recipe fetcher returned a malformed post.', read)
  }

  const caption = typeof read.caption === 'string' && read.caption.trim() ? read.caption : null
  const post: InstagramPostRef = {
    url: httpUrl(read.url) ?? `https://www.instagram.com/p/${shortcode}/`,
    author: typeof read.author === 'string' && read.author.trim() ? read.author.trim().slice(0, 300) : null,
  }

  for (const link of captionLinks(caption)) {
    try {
      const { recipe } = await extractWebsite(link, config, fetcher)
      return { recipe: { ...recipe, source: { ...recipe.source, post } as ExtractedRecipe['source'] } }
    } catch {
      // No recipe there, or the page could not be read: either way the post
      // itself is still worth reading, so this is not the caller's failure.
    }
  }

  // Each its own part, never interpolated into the instructions: a caption is
  // whatever its author wrote, including things that read like instructions.
  const parts: Part[] = [
    ...(caption ? [{ type: 'text' as const, text: caption }] : []),
    ...read.images.map(image => ({ type: 'image' as const, data: image.data, mime_type: image.mimeType })),
  ]
  if (!parts.length) throw fail(422, 'No recipe could be found in that post.')

  const draft = await askGemini(parts, INSTAGRAM_PROMPT, config, fetcher)
  return {
    recipe: parseExtraction(draft, {
      type: 'website',
      url: post.url,
      author: post.author,
      siteName: 'Instagram',
      retrievedAt: new Date().toISOString(),
      post,
    }),
  }
}
