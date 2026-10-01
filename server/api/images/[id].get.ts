import { requireKysely } from '../../utils/database.ts'
import { readImage } from '../../utils/images.ts'
import { isRecipeId, requireOwnerSub } from '../../utils/recipes.ts'

// An image's bytes, for its owner only: there is no public address for one.
// `?size=thumb` is the card-sized copy.
export default defineEventHandler(async (event) => {
  const ownerSub = await requireOwnerSub(event)

  const id = getRouterParam(event, 'id')
  if (!isRecipeId(id)) throw createError({ statusCode: 400, message: 'That is not an image id.' })
  const { size } = getQuery(event)
  if (size !== undefined && size !== 'thumb') throw createError({ statusCode: 400, message: 'size can only be thumb.' })

  const image = await readImage(requireKysely(), ownerSub, id, size === 'thumb' ? 'thumb' : 'full')
  if (!image) throw createError({ statusCode: 404, message: 'No such image.' })

  // The type the bytes were checked to be on upload, and nothing to sniff:
  // these bytes were chosen by a user, and must not become a page here.
  setHeader(event, 'Content-Type', image.media_type)
  setHeader(event, 'X-Content-Type-Options', 'nosniff')
  setHeader(event, 'Content-Security-Policy', "default-src 'none'; sandbox")
  // An id's bytes never change — a replaced image gets a new id — so the
  // browser may keep it for good. Private: it is one person's.
  setHeader(event, 'Cache-Control', 'private, max-age=31536000, immutable')
  return image.bytes
})
