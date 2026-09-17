import type { H3Event } from 'h3'
import { readJsonBody } from './body.ts'
import { fail } from './errors.ts'

// Characters, not bytes. Sized against OLLAMA_CONTEXT_LENGTH in
// docker/compose.ollama.yaml: raising one means revisiting the other.
export const MAX_TEXT_LENGTH = 20_000

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
  return validateText(await readJsonBody(event))
}
