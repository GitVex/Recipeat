import { requireUserSession } from 'nuxt-oidc-auth/runtime/server/utils/session.js'
import { extractPhoto, normalizeRecipe, readExtractionPhoto } from '../../utils/extraction.ts'

export default defineEventHandler(async (event) => {
  // Set before the session check, so the 401 carries it too.
  setHeader(event, 'Cache-Control', 'no-store')
  await requireUserSession(event)
  const photo = await readExtractionPhoto(event)
  // One call: the model is shown the photograph, so nothing between here and it
  // has to work out what the page's layout was.
  const { recipe } = await extractPhoto(photo, useRuntimeConfig(event))
  // Normalization is shared with the text and website pipelines.
  return { recipe: normalizeRecipe(recipe) }
})
