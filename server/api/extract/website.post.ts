import { requireUserSession } from 'nuxt-oidc-auth/runtime/server/utils/session.js'
import { extractWebsite, normalizeRecipe, readExtractionUrl } from '../../utils/extraction.ts'

export default defineEventHandler(async (event) => {
  // Set before the session check, so the 401 carries it too.
  setHeader(event, 'Cache-Control', 'no-store')
  await requireUserSession(event)
  const url = await readExtractionUrl(event)
  // No model on this path: the fetcher reads the page's structured data.
  const { recipe } = await extractWebsite(url, useRuntimeConfig(event))
  // Normalization is shared with the text pipeline, and still finds the
  // measurements inside each step.
  return { recipe: normalizeRecipe(recipe) }
})
