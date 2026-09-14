import { fail } from './errors.ts'
import { parseExtraction, type ExtractedRecipe } from './recipe.ts'

// Well beyond the 20s-4m extractions measured in docs/extraction.md, since
// Ollama runs one request at a time and a queued caller waits behind it.
const REQUEST_TIMEOUT_MS = 300_000

export type OllamaConfig = { ollamaBaseUrl: string, ollamaModel: string }

const SYSTEM_PROMPT = [
  'Extract the recipe in the user message into JSON.',
  'Preserve quantities exactly as written, including fractions, ranges and units.',
  'Use the name of the dish as the title, including when it is only a heading or the first line.',
  'Do not invent missing information: use null only when the source genuinely has no title or portion count.',
  'For each ingredient, copy the whole line into originalText, put only the amount in quantity ("1 1/2 cups", null when the line states none), and put only the food in name.',
  'Keep each step as one string, in the language of the source.',
  'Set source_lang to the BCP-47 tag of that language.',
].join(' ')

// The wire form of RecipeDraft. Ollama compiles this into a llama.cpp grammar,
// so length and item bounds are deliberately absent: they can stop that grammar
// from compiling at all. parseExtraction applies the equivalent limits instead.
const RESPONSE_FORMAT = {
  type: 'object',
  properties: {
    title: { type: ['string', 'null'] },
    source_lang: { type: 'string' },
    portions: { type: ['number', 'null'] },
    ingredients: {
      type: 'array',
      items: {
        type: 'object',
        // Property order is generation order under a grammar: the line is
        // copied verbatim first, then segmented.
        properties: {
          originalText: { type: 'string' },
          quantity: { type: ['string', 'null'] },
          name: { type: 'string' },
        },
        required: ['originalText', 'quantity', 'name'],
        additionalProperties: false,
      },
    },
    steps: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'source_lang', 'portions', 'ingredients', 'steps'],
  additionalProperties: false,
}

export type OllamaMessage = {
  role: 'system' | 'user'
  content: string
  // Base64-encoded images for the model's vision modality, used by photo import.
  images?: string[]
}

/**
 * The transport, shared by every input modality. Sends one chat request and
 * returns the decoded recipe draft, still unvalidated. Each modality supplies
 * its own messages; everything that can go wrong upstream is handled here, and
 * sanitized before it reaches the client.
 */
export async function askOllama(
  messages: OllamaMessage[],
  config: OllamaConfig,
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): Promise<unknown> {
  // Trailing slashes are trimmed rather than resolved away, so a base URL
  // carrying a path prefix survives.
  const url = `${config.ollamaBaseUrl.replace(/[/]+$/, '')}/api/chat`
  const request = {
    model: config.ollamaModel,
    stream: false,
    think: false,
    format: RESPONSE_FORMAT,
    // Extraction copies, it does not compose.
    options: { temperature: 0 },
    messages,
  }

  let response: Response
  try {
    response = await fetcher(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    const name = (error as Error | undefined)?.name
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw fail(504, 'Ollama did not answer in time.', error)
    }
    // Host and port belong in the log, not in a client-facing message.
    if (error instanceof TypeError) throw fail(502, 'Could not connect to Ollama.', error)
    throw fail(502, 'The extraction service is unavailable.', error)
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw fail(502, `Ollama returned HTTP ${response.status}.`, detail.slice(0, 500))
  }

  let payload: { done_reason?: string, message?: { content?: string } }
  try {
    payload = await response.json()
  } catch (error) {
    throw fail(502, 'Ollama returned a malformed response.', error)
  }

  // A truncated answer can still be valid JSON, so this is checked separately.
  if (payload.done_reason === 'length') {
    throw fail(502, 'Ollama stopped before finishing the recipe; the source may exceed the model context.')
  }

  const content = payload.message?.content
  if (typeof content !== 'string') throw fail(502, 'Ollama returned no message content.', payload)

  try {
    return JSON.parse(content)
  } catch (error) {
    throw fail(502, 'Ollama returned invalid JSON.', error)
  }
}

/**
 * The text modality. A sibling for photos differs only in the messages it
 * builds and the RecipeSource it records; the transport and the validation
 * below it are the same.
 */
export async function extractText(
  text: string,
  config: OllamaConfig,
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): Promise<{ recipe: ExtractedRecipe }> {
  const draft = await askOllama([
    { role: 'system', content: SYSTEM_PROMPT },
    // The source is its own message, never interpolated into the instructions.
    { role: 'user', content: text },
  ], config, fetcher)
  return { recipe: parseExtraction(draft, { type: 'text', originalText: text }) }
}
