import { getHeader, readMultipartFormData, type H3Event } from 'h3'
import { fail } from './errors.ts'

/**
 * Reading a photo upload off the wire. What is done with it afterwards belongs
 * to `gemini.ts`, which sends the bytes as they arrived: nothing here decodes
 * the image, because nothing here needs to know what is in it.
 */

// Bytes, not characters. Gemini caps a request carrying inline image data at
// 20 MB, and base64 adds about a third, so ten here leaves room for the prompt
// and the envelope with margin to spare.
export const MAX_PHOTO_BYTES = 10_000_000
// A filename is the user's, shown back to them and stored beside the recipe.
const MAX_FILENAME_LENGTH = 255
const FIELD = 'file'

export type Photo = { data: Uint8Array, filename: string | null, type: string | null }

/**
 * The name the browser sent, or null. A part name is chosen by whoever posted
 * it, so the directory components are dropped and the rest is clamped — it is
 * a label, and it is never used to open anything.
 */
function filenameOf(value: string | undefined): string | null {
  if (typeof value !== 'string') return null
  const base = value.split(/[/\\]/).pop()?.trim()
  return base ? base.slice(0, MAX_FILENAME_LENGTH) : null
}

export async function readExtractionPhoto(event: H3Event): Promise<Photo> {
  const type = (getHeader(event, 'content-type') ?? '').split(';')[0]!.trim().toLowerCase()
  if (type !== 'multipart/form-data') {
    throw fail(415, 'Expected a multipart/form-data request body with a "file" part.')
  }

  // A pre-filter only. Content-Length is the sender's claim, so the bytes are
  // counted below as well; this just stops an obvious flood being buffered
  // first. The envelope adds a boundary and headers to the file's own size.
  const claimed = Number(getHeader(event, 'content-length'))
  if (Number.isFinite(claimed) && claimed > MAX_PHOTO_BYTES + 4096) {
    throw fail(413, `Photos are limited to ${MAX_PHOTO_BYTES} bytes.`)
  }

  let parts: Awaited<ReturnType<typeof readMultipartFormData>>
  try {
    parts = await readMultipartFormData(event)
  } catch (error) {
    throw fail(400, 'Request body is not valid multipart/form-data.', error)
  }

  const part = parts?.find(item => item.name === FIELD)
  if (!part) throw fail(400, 'Expected a "file" part carrying the photo.')
  if (part.data.length > MAX_PHOTO_BYTES) throw fail(413, `Photos are limited to ${MAX_PHOTO_BYTES} bytes.`)
  if (!part.data.length) throw fail(400, 'That photo was empty.')

  return {
    data: part.data,
    filename: filenameOf(part.filename),
    // The browser's guess, and now the only thing that says what these bytes
    // are: nothing on this side decodes them any more. It is forwarded as the
    // image's media type, and a wrong one is answered for by the model rather
    // than caught here.
    type: typeof part.type === 'string' && part.type ? part.type.slice(0, 100) : null,
  }
}
