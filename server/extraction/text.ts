import { getHeader, readBody, type H3Event } from 'h3'
import { fail } from './errors.ts'

// Characters, not bytes. Sized against OLLAMA_CONTEXT_LENGTH in
// docker/compose.ollama.yaml: raising one means revisiting the other.
export const MAX_TEXT_LENGTH = 20_000

// application/json, plus vendor types such as application/vnd.api+json.
const JSON_TYPE = /^application\/([\w.+-]+\+)?json$/i

export function validateText(body: unknown): string {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw fail(400, 'Expected a JSON object with a "text" property.')
  }
  const { text } = (body as { text?: unknown })
  if (typeof text !== 'string') throw fail(400, 'Expected "text" to be a string.')
  if (text.length > MAX_TEXT_LENGTH) throw fail(413, `Recipe text is limited to ${MAX_TEXT_LENGTH} characters.`)
  // Whitespace decides emptiness, but the source is handed on unmodified.
  if (!text.trim()) throw fail(400, 'Recipe text must not be empty.')
  return text
}

export async function readExtractionText(event: H3Event): Promise<string> {
  // The parameters after ";" (charset and friends) are not our concern.
  if (!JSON_TYPE.test((getHeader(event, 'content-type') ?? '').split(';')[0]!.trim())) {
    throw fail(415, 'Expected a JSON request body.')
  }
  let body: unknown
  try {
    // strict: true so a malformed body throws instead of arriving as a string.
    body = await readBody(event, { strict: true })
  } catch (error) {
    throw fail(400, 'Request body is not valid JSON.', error)
  }
  return validateText(body)
}
