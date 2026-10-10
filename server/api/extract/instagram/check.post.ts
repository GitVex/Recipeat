import { requireUserSession } from 'nuxt-oidc-auth/runtime/server/utils/session.js'
import { checkInstagram, readExtractionUrl } from '../../../utils/extraction.ts'
import { instagramShortcode } from '../../../../shared/utils/instagram.ts'

// What the import dialog says before an Instagram post is sent (#219): where
// its caption puts the recipe. The post is read without its media, and no
// model is asked.
export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  await requireUserSession(event)
  const shortcode = instagramShortcode(await readExtractionUrl(event))
  if (!shortcode) throw createError({ statusCode: 400, message: 'Not a link to an Instagram post.' })
  return { verdict: await checkInstagram(shortcode, useRuntimeConfig(event)) }
})
