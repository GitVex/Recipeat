import { fail } from './errors.ts'
import type { Photo } from './photo.ts'
import { parseExtraction, type ExtractedRecipe } from './recipe.ts'
// The same file Ollama was given, unchanged. Gemini's structured output takes a
// subset of JSON Schema, and every keyword this schema uses — `type` arrays for
// the nullable fields, `properties`, `required`, `additionalProperties`,
// `items` — is inside it, so there was nothing to port.
//
// One thing did not survive the move. Under a llama.cpp grammar, property order
// is generation order, which is why `originalText` sits before `quantity`: the
// line is copied verbatim before it is taken apart. Gemini makes no such
// promise, so that ordering is now only a hint, and the system prompt below
// carries the instruction on its own.
import RESPONSE_SCHEMA from './recipe-draft.schema.json' with { type: 'json' }

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions'

// A minute, where Ollama was given five. The model is no longer sharing two
// cores with an OCR container; what is being waited on now is a network round
// trip and a hosted model, and a browser should not hang past that.
const REQUEST_TIMEOUT_MS = 60_000

// Enough for the longest recipe plus the JSON around it. Reached only by a
// source that is not one recipe, which `parseExtraction` would reject anyway.
const MAX_OUTPUT_TOKENS = 8192

export type GeminiConfig = { geminiApiKey: string, geminiModel: string }

/** One piece of what the model is shown: the source text, or the photo. */
export type Part =
  | { type: 'text', text: string }
  | { type: 'image', data: string, mime_type: string }

export const SYSTEM_PROMPT = [
  'Extract the recipe in the user message into JSON.',
  'Preserve quantities exactly as written, including fractions, ranges and units.',
  'Use the name of the dish as the title, including when it is only a heading or the first line.',
  'Do not invent missing information: use null whenever the source genuinely does not state it.',
  'For each ingredient, copy the whole line into originalText first, then put only the amount in quantity ("1 1/2 cups", null when the line states none), and put only the food in name.',
  'Put whatever else the line says about that ingredient — how it is prepared, what it is for — in extra ("finely diced", "for the sauce"), and null when it says nothing more.',
  'Set totalTime to the total time in whole minutes when the source states one, and null otherwise.',
  'Keep each step as one string, in the language of the source.',
  'Set source_lang to the BCP-47 tag of that language.',
].join(' ')

// What is true of a photograph rather than a paste. Shorter than the prompt the
// OCR pipeline needed: there is no reading between the model and the page any
// more, so there are no OCR artefacts to warn about and no columns that some
// earlier stage may already have interleaved. What is left is the page itself.
export const PHOTO_PROMPT = [
  SYSTEM_PROMPT,
  'The user message is a photograph of a recipe, which may be handwritten and may be laid out in columns.',
  'Read the columns in their own order rather than straight across the page, and read quantities with particular care — a misread amount becomes a wrong recipe, where a misread word stays a typo.',
  'Anything that is not part of the recipe — a page number, a caption, a headline from the facing page — is neither an ingredient nor a step.',
].join(' ')

/**
 * The transport, shared by every input modality. Sends one interaction and
 * returns the decoded recipe draft, still unvalidated. Each modality supplies
 * its own parts; everything that can go wrong upstream is handled here, and
 * sanitized before it reaches the client.
 */
export async function askGemini(
  input: Part[],
  system: string,
  config: GeminiConfig,
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): Promise<unknown> {
  const request = {
    model: config.geminiModel,
    input,
    system_instruction: system,
    // These three nest here rather than sitting top-level, which the API is
    // strict about: a top-level `temperature` comes back as
    // `Unknown parameter 'temperature'` with no hint that it has a home.
    generation_config: {
      // Extraction copies, it does not compose.
      temperature: 0,
      // There is nothing here to reason about: every field is either in the
      // source or is null. Thinking would buy latency and nothing else.
      thinking_level: 'low',
      max_output_tokens: MAX_OUTPUT_TOKENS,
    },
    // No conversation is being continued, so there is nothing to keep. Said
    // explicitly rather than left to the default: a recipe someone photographed
    // is theirs, and this is the request that decides whether a copy stays.
    store: false,
    response_format: {
      type: 'text',
      mime_type: 'application/json',
      schema: RESPONSE_SCHEMA,
    },
  }

  let response: Response
  try {
    response = await fetcher(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': config.geminiApiKey,
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    const name = (error as Error | undefined)?.name
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw fail(504, 'The extraction service did not answer in time.', error)
    }
    if (error instanceof TypeError) throw fail(502, 'Could not reach the extraction service.', error)
    throw fail(502, 'The extraction service is unavailable.', error)
  }

  if (!response.ok) {
    // Read for the code, log the rest, forward none of it: an error from Google
    // names the model, the project and sometimes the key, none of which is the
    // caller's business.
    const detail = await response.text().catch(() => '')
    let code = ''
    try {
      code = String(JSON.parse(detail)?.error?.code ?? '')
    } catch { /* not JSON; the status carries what there is to know */ }

    // The code, not the status. Google answers a capacity problem with HTTP 400
    // and `code: "service_unavailable"` — mapped on status alone that becomes a
    // 502, which says the service is broken when it is merely busy. Both of
    // these are the deployment's quota or Google's load rather than a mistake
    // the caller made, so neither is passed through as a 4xx of their own.
    if (code === 'service_unavailable' || code === 'too_many_requests' || response.status === 429) {
      throw fail(503, 'The extraction service is busy; try again shortly.', detail.slice(0, 500))
    }
    if (response.status === 401 || response.status === 403) {
      throw fail(502, 'The extraction service rejected our credentials.', detail.slice(0, 500))
    }
    throw fail(502, `The extraction service returned HTTP ${response.status}.`, detail.slice(0, 500))
  }

  let payload: { status?: unknown, output_text?: unknown, steps?: unknown }
  try {
    payload = await response.json()
  } catch (error) {
    throw fail(502, 'The extraction service returned a malformed response.', error)
  }

  // Checked before the content, because a truncated answer can still be valid
  // JSON — the schema holds right up until the output stops. This is the field
  // that says so; `max_output_tokens` reached is not a parse error.
  if (payload?.status !== 'completed') {
    throw fail(502, 'The extraction service stopped before finishing the recipe.', payload?.status)
  }

  const content = textOf(payload)
  if (!content.trim()) throw fail(502, 'The extraction service returned no content.', payload)

  try {
    return JSON.parse(content)
  } catch (error) {
    throw fail(502, 'The extraction service returned invalid JSON.', error)
  }
}

/**
 * The model's answer, out of the interaction.
 *
 * `output_text` is an SDK convenience and is not in the REST body: what comes
 * back is `steps`, one per thing the model did, of which the answer is the
 * `model_output` ones. The thinking step sits in there too and is deliberately
 * passed over — under a response schema only the output blocks are the JSON.
 * The field is still read first in case a later version starts sending it.
 */
function textOf(payload: { output_text?: unknown, steps?: unknown }): string {
  if (typeof payload.output_text === 'string') return payload.output_text
  if (!Array.isArray(payload.steps)) return ''

  return payload.steps
    .filter((step: unknown) => (step as { type?: unknown })?.type === 'model_output')
    .flatMap((step: unknown) => {
      const content = (step as { content?: unknown }).content
      return Array.isArray(content) ? content : []
    })
    .filter((block: unknown) => (block as { type?: unknown })?.type === 'text')
    .map((block: unknown) => String((block as { text?: unknown }).text ?? ''))
    .join('')
}

/**
 * The text modality. The source is its own part, never interpolated into the
 * instructions, which is what keeps a recipe that talks about instructions from
 * being read as one.
 */
export async function extractText(
  text: string,
  config: GeminiConfig,
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): Promise<{ recipe: ExtractedRecipe }> {
  const draft = await askGemini(
    [{ type: 'text', text }],
    SYSTEM_PROMPT,
    config,
    fetcher,
  )
  return { recipe: parseExtraction(draft, { type: 'text', originalText: text }) }
}

/**
 * The photo modality. One call: the model is shown the photograph itself, so
 * there is no reading step between the page and the recipe, and nothing has to
 * decide what the page's layout was before the model sees it.
 */
export async function extractPhoto(
  photo: Photo,
  config: GeminiConfig,
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): Promise<{ recipe: ExtractedRecipe }> {
  const draft = await askGemini(
    [{
      type: 'image',
      data: Buffer.from(photo.data).toString('base64'),
      // The browser's guess, and the only thing we have — the bytes are no
      // longer decoded on our side. Gemini reads the image itself and answers
      // for a type it cannot take.
      mime_type: photo.type ?? 'image/jpeg',
    }],
    PHOTO_PROMPT,
    config,
    fetcher,
  )
  return {
    recipe: parseExtraction(draft, {
      type: 'photo',
      // Nothing stores the image yet, so there is no key to record. See
      // docs/planning.md: object storage is what fills this in.
      objectKey: null,
      originalFilename: photo.filename,
    }),
  }
}
