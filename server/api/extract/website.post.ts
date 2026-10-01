import { requireUserSession } from 'nuxt-oidc-auth/runtime/server/utils/session.js'
import { extractInstagram, extractWebsite, normalizeRecipe, readExtractionUrl } from '../../utils/extraction.ts'
import { instagramShortcode } from '../../../shared/utils/instagram.ts'

export default defineEventHandler(async (event) => {
  // Set before the session check, so the 401 carries it too.
  setHeader(event, 'Cache-Control', 'no-store')
  await requireUserSession(event)
  const url = await readExtractionUrl(event)
  // A link to an Instagram post is a website import too (#120), but a post has
  // no recipe markup: its caption links are tried, then the model reads it.
  // Only the shortcode goes on, so the caller still cannot name a host for it.
  const shortcode = instagramShortcode(url)
  // Otherwise no model: the fetcher reads the page's structured data.
  const { recipe } = shortcode
    ? await extractInstagram(shortcode, useRuntimeConfig(event))
    : await extractWebsite(url, useRuntimeConfig(event))
  // Normalization is shared with the text pipeline, and still finds the
  // measurements inside each step.
  return { recipe: normalizeRecipe(recipe) }
})
