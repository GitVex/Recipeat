import type { H3Event } from 'h3'
import { readJsonBody } from './body.ts'
import { fail } from './errors.ts'

// Characters, not bytes. No longer a context-window limit — the model behind
// this reads a million tokens — but a ceiling on what one extraction is
// allowed to be. Twenty thousand characters is a long recipe and several
// pages of anything else, and the cost of a request scales with it.
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
