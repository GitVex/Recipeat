# Extraction

`POST /api/extract/text` turns pasted recipe text into a structured recipe. It
requires a session, calls [Ollama](./ollama.md), and returns the result without
storing it, so an extraction can be previewed before it is kept.

```sh
curl -X POST http://localhost:3000/api/extract/text \
  -H 'Content-Type: application/json' \
  -b 'your-session-cookie' \
  -d '{"text":"2 eggs, beaten.\nFry them in butter."}'
```

Request: `{ "text": string }`, at most 20 000 characters.
Response: `{ "recipe": { … } }`, shaped as below.

| Status | Meaning |
|---|---|
| 401 | No session |
| 415 | Content type is not JSON |
| 400 | Body is not valid JSON, or `text` is missing, not a string, or blank |
| 413 | `text` is over 20 000 characters |
| 422 | The model found no recipe in the text |
| 502 | Ollama unreachable, failed, or answered with something unusable |
| 504 | Ollama did not answer within five minutes |

Client-facing messages are sanitized. The detail — upstream response bodies,
host names, stack traces — rides on the error's `cause`, which Nitro logs
server-side and never serializes to the client.

## The pipeline

Four steps, in `server/extraction/`, behind the barrel at
`server/utils/textExtraction.ts`.

1. **`readExtractionText`** — content type, JSON parse, then `validateText`
   for presence and length. The text is passed on unmodified; whitespace only
   decides whether it is empty.
2. **`extractText`** — one `/api/chat` call: `stream: false`, `think: false`,
   `temperature: 0`, a JSON schema in `format`, and the source as its own user
   message, never interpolated into the instructions. Rejects a truncated
   answer (`done_reason: "length"`) even when it parses.
3. **`parseExtraction`** — validates and clamps, then assigns IDs.
4. **`normalizeRecipe`** — reads quantities into numbers and units, finds
   measurements in step prose, and links steps back to ingredients.

### What the model is asked for, and what it is not

The schema constrains generation to a recipe object and to splitting each
ingredient line into an amount and a food, with the line copied verbatim first —
property order is generation order under a grammar.

It carries **no** `minLength`, `maxLength`, `minItems` or `maxItems`. Bounded
repetitions can stop llama.cpp compiling the grammar at all, so the equivalent
limits are applied to the response instead.

Everything exact is done afterwards in code, because it is deterministic, costs
no tokens, and is testable without a model running:

- Reading `"1 1/2 cups"` into `{ value: 1.5, unit: "cup" }`. The model cannot
  know whether a cup is US or metric, so the ambiguous unit is kept and resolved
  at display time.
- Finding `180C` and `20 minutes` inside a step.
- Deciding that a step restating an ingredient's amount should reference it.

That last one is the reason it cannot be a grammar's job: JSON Schema cannot
express "this string matches a key defined elsewhere in the same document", so a
model would be free to emit dangling references. Every ID here is created by the
code that also emits the reference.

### Recovering rather than failing

Only two things stop a request: an envelope that cannot be a recipe (502) and an
extraction with nothing in it (422). Everything else recovers, because a
slightly wrong field still makes a usable recipe:

| Model output | Result |
|---|---|
| `portions: -1`, `Infinity` | `null` |
| Blank title | `null` |
| Blank `source_lang` | `"und"` |
| Title over 300 chars | Truncated |
| Ingredient over 2000, step over 5000 | Truncated |
| Over 200 ingredients, over 100 steps | Sliced |
| Non-string or blank list entries | Dropped |

IDs are assigned after filtering and slicing, so they stay dense and no
reference can point at a dropped line.

## The recipe

```ts
type Recipe = {
  title: string | null          // null when the source names no dish
  source_lang: string           // BCP-47, "und" when unknown
  portions: number | null
  ingredients: Ingredient[]
  steps: Step[]
  source: { type: 'text', originalText: string }
}

type Ingredient = {
  id: string                    // "ingredient_1", dense and stable
  originalText: string          // the line, verbatim
  name: string                  // the food alone; falls back to the line
  quantityText: string | null   // the amount alone, as the model split it
  quantity: Quantity | null     // parsed; null when the line states no amount
}

type Step = {
  id: string                    // "step_1"
  originalText: string
  parts: StepPart[]
  quantities: Record<string, StepQuantity>
}

type StepPart =
  | { type: 'text', value: string }
  | { type: 'measurement', quantity: string }        // key into step.quantities
  | { type: 'ingredientQuantity', ingredientId: string }

type Quantity = {
  value: number
  maxValue: number | null       // set for ranges: "2-3 tbsp"
  unit: Unit | null             // null when the wording is unrecognised
}

type StepQuantity = Quantity & {
  kind: QuantityKind            // mass | volume | count | temperature | duration | length | other
  scaleWithPortions: boolean | null
}
```

`originalText` is kept everywhere so nothing is lost to a parser that will get
better later, and so `quantityText` can be re-read without paying for inference
again.

**`parts` and `quantities`** let the UI rescale a recipe without rewriting
prose. `"Bake at 180C for 20 minutes."` becomes five parts, with the temperature
and duration marked `scaleWithPortions: false` — ovens and timers do not change
when portions do.

**`ingredientQuantity`** appears when a step restates an ingredient's full
amount, so the two rescale together. The amount must match exactly and the
ingredient must be named in the step: `"1 cup of the milk"` drawn from
`"2 cups milk"` is a portion of it, not a restatement, and stays a plain
measurement.

## Testing

```sh
npm run test:extraction
```

Thirteen cases over the whole pipeline with no browser and no model: a fake
`fetch` covers the Ollama contract and its failure modes, and quantity parsing
and normalization are pure functions. One case asserts that every reference in
a normalized recipe resolves — worth keeping as the matching rules change.

The auth suite covers the endpoint's 401 and its validation.

For a live check, open the app with a [tunnel](./ollama.md#local-development)
running, sign in, and call it from the devtools console so the session cookie
comes along:

```js
await (await fetch('/api/extract/text', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ text: '2 eggs, beaten.\nFry them in butter.' }),
})).json()
```

The first call is slow while the model loads; judge speed from the second.

Measured on the VPS, for sizing expectations:

| Source | Time |
|---|---|
| Short text | 20s |
| Trimmed HTML page | 2m 17s |
| Full-resolution photo | 4m 5s |

Those numbers are why the request timeout is five minutes, and why photo and
website import will need a job-and-poll design rather than one long POST — see
[planning](./planning.md).
