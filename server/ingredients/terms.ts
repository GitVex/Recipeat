/**
 * Step 3a of canonization (#154): on an alias miss, the local model gives each
 * name 2–3 English search terms, US names included, and its head food without
 * qualifiers ("chili" for "kashmiri chili"), which is what FoodData Central
 * candidates are retrieved with (#160). A recipe's misses go in one call.
 *
 * Every failure throws, so the worker (#162) retries the recipe later; nothing
 * here returns empty or guessed terms.
 */

export type OllamaConfig = { ollamaBaseUrl: string, ollamaModel: string, ollamaThreads: number }

/** What `canonization_decisions.search_terms` holds for one name. */
export type SearchTerms = { terms: string[], head: string }

// Bumped whenever the prompt or schema changes, so decisions logged under the
// old one can be told apart.
export const PROMPT_VERSION = 'terms-1'

// Ollama runs one request at a time, so a queued call waits behind another.
const REQUEST_TIMEOUT_MS = 120_000

export const SYSTEM_PROMPT = [
  'The user message is a JSON list of ingredient names from one recipe, and the language it is written in.',
  'Answer for each name, in the same order.',
  'english: the name in English, spelled correctly, keeping every qualifier that changes the food ("kashmiri chili", "smoked paprika", "brown sugar"), without brand names.',
  'synonyms: one or two other English names for exactly that food, as the USDA FoodData Central database would name it; where American and British English differ, the American one ("zucchini" for "courgette", "cilantro" for "coriander leaves"). Never a different food.',
  'head: the plain food without any qualifier ("chili", "paprika", "sugar"), singular.',
  'Write everything in lowercase.',
].join(' ')

// Ollama compiles this into a grammar, so the answer cannot be prose, and
// property order is generation order: `name` is echoed to keep the model on
// the list, and `english` comes before `synonyms` because a 2B model ignores
// "the first term is the name itself" in prose but not as a field.
// Built per call: the item count is fixed to the names sent, since without it
// a 2B model answered a German list of ten with one item or none.
const responseFormat = (count: number) => ({
  type: 'object',
  properties: {
    items: {
      type: 'array',
      minItems: count,
      maxItems: count,
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          english: { type: 'string' },
          synonyms: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 2 },
          head: { type: 'string' },
        },
        required: ['name', 'english', 'synonyms', 'head'],
      },
    },
  },
  required: ['items'],
})

const fail = (message: string, cause?: unknown) => new Error(message, { cause })

const isText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== ''

/**
 * Search terms for each of `names`, the food alone (`Ingredient.name`, never
 * its `extra`), in a recipe of `lang` (its `source_lang`). One result per
 * name, in order.
 */
export async function searchTerms(
  names: string[],
  lang: string,
  config: OllamaConfig,
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): Promise<SearchTerms[]> {
  if (!names.length) return []
  const url = `${config.ollamaBaseUrl.replace(/[/]+$/, '')}/api/chat`
  const request = {
    model: config.ollamaModel,
    stream: false,
    think: false,
    format: responseFormat(names.length),
    // num_thread: Ollama otherwise starts one per host core, past its CPU cap.
    options: { temperature: 0, num_thread: config.ollamaThreads },
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      // The names are data, never interpolated into the instructions.
      { role: 'user', content: JSON.stringify({ language: lang, names }) },
    ],
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
    if (name === 'TimeoutError' || name === 'AbortError') throw fail('Ollama did not answer in time.', error)
    throw fail('Could not connect to Ollama.', error)
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw fail(`Ollama returned HTTP ${response.status}.`, detail.slice(0, 500))
  }

  let payload: { done_reason?: string, message?: { content?: unknown } }
  try {
    payload = await response.json()
  } catch (error) {
    throw fail('Ollama returned a malformed response.', error)
  }
  // A truncated answer can still be valid JSON.
  if (payload.done_reason === 'length') throw fail('Ollama stopped before finishing the search terms.')
  let answer: { items?: unknown }
  try {
    answer = JSON.parse(String(payload.message?.content))
  } catch (error) {
    throw fail('Ollama returned invalid JSON.', error)
  }

  // The grammar should already hold all of this; checked anyway, since a
  // model that drops or merges a name would shift every result after it.
  const items = answer?.items
  if (!Array.isArray(items) || items.length !== names.length) {
    throw fail(`Ollama answered for ${Array.isArray(items) ? items.length : 0} of ${names.length} names.`, answer)
  }
  return items.map((item, i) => {
    const { english, synonyms, head } = (item ?? {}) as { english?: unknown, synonyms?: unknown, head?: unknown }
    if (!isText(english) || !Array.isArray(synonyms) || synonyms.length < 1 || synonyms.length > 2
      || !synonyms.every(isText) || !isText(head)) {
      throw fail(`Ollama answered outside the schema for "${names[i]}".`, item)
    }
    return { terms: [english, ...synonyms].map(t => t.trim().toLowerCase()), head: head.trim().toLowerCase() }
  })
}
