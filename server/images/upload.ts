import type { H3Event } from 'h3'
import { fail } from '../extraction/errors.ts'
import { readMultipart } from '../extraction/photo.ts'
import type { ImageType } from '../database/schema.ts'
import { MAX_IMAGE_BYTES, MAX_THUMB_BYTES } from '../../shared/utils/images.ts'

/**
 * An image upload: two parts, `image` and `thumb`, each a derivative the
 * browser already made. Nothing here decodes them. What is checked is what can
 * be checked without a decoder: the size of each, and that the bytes start the
 * way a JPEG or a WebP file does. The type is read from those bytes, never
 * taken from the part's own header, because it is what the image is served
 * as later: an upload that says it is HTML must not become a page on this
 * origin.
 */

// The same ceilings as the table's CHECKs, so an oversized upload is a 413
// with a reason rather than a constraint error.
export { MAX_IMAGE_BYTES, MAX_THUMB_BYTES }

export type ImageUpload = { mediaType: ImageType, data: Uint8Array, thumb: Uint8Array }

const ascii = (bytes: Uint8Array, start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end))

export function sniffImage(bytes: Uint8Array): ImageType | null {
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'image/jpeg'
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'image/webp'
  return null
}

type Part = { name?: string, data: Uint8Array }

export function imageUpload(parts: Part[]): ImageUpload {
  const take = (name: string, max: number) => {
    const part = parts.find(item => item.name === name)
    if (!part?.data.length) throw fail(400, `Expected an "${name}" part carrying the picture.`)
    if (part.data.length > max) throw fail(413, `The ${name} is limited to ${max} bytes.`)
    return part.data
  }
  const data = take('image', MAX_IMAGE_BYTES)
  const thumb = take('thumb', MAX_THUMB_BYTES)
  const mediaType = sniffImage(data)
  if (!mediaType) throw fail(415, 'Images have to be JPEG or WebP.')
  // One type per row: both sizes are served as what the row says.
  if (sniffImage(thumb) !== mediaType) throw fail(415, 'The thumb has to be the same kind of image as the picture.')
  return { mediaType, data, thumb }
}

export async function readImageUpload(event: H3Event): Promise<ImageUpload> {
  return imageUpload(await readMultipart(event, MAX_IMAGE_BYTES + MAX_THUMB_BYTES))
}
