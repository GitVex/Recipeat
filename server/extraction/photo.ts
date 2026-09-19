import { getHeader, readMultipartFormData, type H3Event } from 'h3'
import { fail } from './errors.ts'
import { askOllama, SYSTEM_PROMPT, type OllamaConfig } from './ollama.ts'
import { parseExtraction, type ExtractedRecipe } from './recipe.ts'
import { MAX_TEXT_LENGTH } from './text.ts'

// Bytes, not characters. Matches OCR_MAX_BYTES in docker/compose.ocr.yaml:
// raising one means raising the other, or the service answers 413 first.
export const MAX_PHOTO_BYTES = 10_000_000
// Enough for detection, recognition and a decode, none of which involve a
// model that thinks. The text pipeline's five minutes come after this.
const REQUEST_TIMEOUT_MS = 120_000
// A filename is the user's, shown back to them and stored beside the recipe.
const MAX_FILENAME_LENGTH = 255
const FIELD = 'file'

export type OcrConfig = { ocrBaseUrl: string }
export type Photo = { data: Uint8Array, filename: string | null, type: string | null }

// A detail from the OCR service is a message we wrote about the caller's own
// upload, so it is passed on, capped in case that ever stops being true.
const MAX_DETAIL_LENGTH = 200
// 415 keeps its meaning on this path, unlike the website one: the caller really
// did send a body this service cannot read, because the body is the photo.
const STATUS = new Map([[413, 413], [415, 415], [422, 422], [504, 504]])

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
    // The browser's guess. Forwarded so the service can log it, never trusted:
    // what the bytes actually are is decided by decoding them.
    type: typeof part.type === 'string' && part.type ? part.type.slice(0, 100) : null,
  }
}

async function askOcr(
  photo: Photo,
  config: OcrConfig,
  fetcher: typeof globalThis.fetch,
): Promise<string> {
  // Trailing slashes are trimmed rather than resolved away, so a base URL
  // carrying a path prefix survives.
  const url = `${config.ocrBaseUrl.replace(/[/]+$/, '')}/ocr`
  const form = new FormData()
  // FastAPI reads this part as an upload only when it carries a filename.
  form.append(FIELD, new Blob([photo.data as BlobPart], { type: photo.type ?? 'application/octet-stream' }), photo.filename ?? 'photo')

  let response: Response
  try {
    response = await fetcher(url, { method: 'POST', body: form, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  } catch (error) {
    const name = (error as Error | undefined)?.name
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw fail(504, 'That photo took too long to read.', error)
    }
    if (error instanceof TypeError) throw fail(502, 'Could not connect to the OCR service.', error)
    throw fail(502, 'The extraction service is unavailable.', error)
  }

  if (!response.ok) {
    const detail = await response.json().then(body => (body as { detail?: unknown })?.detail).catch(() => null)
    const message = typeof detail === 'string' && detail.trim()
      ? detail.slice(0, MAX_DETAIL_LENGTH)
      : 'That photo could not be read.'
    throw fail(STATUS.get(response.status) ?? 502, message, detail ?? `HTTP ${response.status}`)
  }

  let payload: { text?: unknown }
  try {
    payload = await response.json()
  } catch (error) {
    throw fail(502, 'The OCR service returned a malformed response.', error)
  }

  const text = payload?.text
  if (typeof text !== 'string' || !text.trim()) {
    throw fail(502, 'The OCR service returned no text.', payload)
  }
  // The same ceiling the text endpoint enforces, for the same reason: it is
  // sized against OLLAMA_CONTEXT_LENGTH. A photo of one page is nowhere near
  // it, so this is a stack of pages rather than a recipe.
  if (text.length > MAX_TEXT_LENGTH) {
    throw fail(413, `That photo holds more than the ${MAX_TEXT_LENGTH} characters an extraction can read.`)
  }
  return text
}

// What the text pipeline asks for, plus what is true of a photograph. It says
// nothing about correcting the reading: the model is asked to copy, and an OCR
// slip invented into something plausible is worse than one left visible.
const PHOTO_PROMPT = [
  SYSTEM_PROMPT,
  'The text was read from a photograph by OCR, so line breaks may fall mid-sentence, and columns may be interleaved.',
  'Anything that is not part of the recipe — a page number, a caption, a headline from the facing page — is neither an ingredient nor a step.',
].join(' ')

/**
 * The photo modality. Two services, in order: the OCR service turns the image
 * into text, and the same model the text pipeline uses turns that into a
 * recipe. No image ever reaches Ollama — the model reads what OCR read.
 */
export async function extractPhoto(
  photo: Photo,
  config: OllamaConfig & OcrConfig,
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): Promise<{ recipe: ExtractedRecipe, text: string }> {
  const text = await askOcr(photo, config, fetcher)
  const draft = await askOllama([
    { role: 'system', content: PHOTO_PROMPT },
    // The reading is its own message, never interpolated into the instructions.
    { role: 'user', content: text },
  ], config, fetcher)

  return {
    recipe: parseExtraction(draft, {
      type: 'photo',
      // Nothing stores the image yet, so there is no key to record. See
      // docs/planning.md: object storage is what fills this in.
      objectKey: null,
      originalFilename: photo.filename,
    }),
    // Handed back so a caller can show what was read when the recipe looks
    // wrong. The endpoint does not return it; the pipeline does not hide it.
    text,
  }
}
