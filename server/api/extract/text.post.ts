import { requireUserSession } from 'nuxt-oidc-auth/runtime/server/utils/session.js'
import { extractText, normalizeRecipe, readExtractionText } from '../../utils/extraction.ts'

export default defineEventHandler(async (event) => {
  // Set before the session check, so the 401 carries it too.
  setHeader(event, 'Cache-Control', 'no-store')
  await requireUserSession(event)
  const text = await readExtractionText(event)
  const { recipe } = await extractText(text, useRuntimeConfig(event))
  // Normalization is deterministic, so it runs after the model has answered
  // rather than being asked of it.
  return { recipe: normalizeRecipe(recipe) }
})
