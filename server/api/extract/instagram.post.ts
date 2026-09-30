import { requireUserSession } from 'nuxt-oidc-auth/runtime/server/utils/session.js'
import { extractInstagram, normalizeRecipe, readExtractionInstagram } from '../../utils/extraction.ts'

export default defineEventHandler(async (event) => {
  // Set before the session check, so the 401 carries it too.
  setHeader(event, 'Cache-Control', 'no-store')
  await requireUserSession(event)
  const shortcode = await readExtractionInstagram(event)
  // The fetcher reads the post; the model reads its caption and images at once.
  const { recipe } = await extractInstagram(shortcode, useRuntimeConfig(event))
  // Normalization is shared with the other three pipelines.
  return { recipe: normalizeRecipe(recipe) }
})
