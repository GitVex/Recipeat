# Extraction

Three endpoints, one recipe shape. All require a session and store nothing, so
an extraction can be previewed before it is kept.

| | |
|---|---|
| `POST /api/extract/text` | Pasted text, read by [Ollama](./ollama.md) |
| `POST /api/extract/website` | A URL, read by the [fetcher](../services/recipeat-fetcher/README.md) with no model at all |
| `POST /api/extract/photo` | A photo, read by the [OCR service](../services/recipeat-ocr/README.md) and then by Ollama |

## Text

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

## Website

```sh
curl -X POST http://localhost:3000/api/extract/website \
  -H 'Content-Type: application/json' \
  -b 'your-session-cookie' \
  -d '{"url":"https://www.seriouseats.com/..."}'
```

Request: `{ "url": string }`, http or https, at most 2048 characters.
Response: the same `{ "recipe": { … } }` as above.

| Status | Meaning |
|---|---|
| 401 | No session |
| 415 | Content type is not JSON |
| 400 | Body is not valid JSON, or `url` is missing, not a string, or not an http(s) address |
| 413 | The URL is too long, or the page is too large to read |
| 422 | No scraper supports that site, the page holds no recipe, or the URL serves something that is not a page |
| 502 | The site failed or was unreachable, or the fetcher could not be reached |
| 504 | The site did not answer in time |

**No model runs on this path.** `recipe-scrapers` reads the page's structured
data and `ingredient-parser` segments each ingredient line, both
deterministically. A page that took 2m 17s through Ollama takes seconds, which
is why this is an ordinary request and not a job and a poll.

The fetcher's own 4xx messages name the host the caller asked for, so they are
passed on rather than replaced with something vaguer. Its 415 arrives as a 422,
since a URL serving a PDF is a problem with what was asked for, not with the
content type of the request that asked.

Two strings a page chooses for itself — its canonical link and its image — are
stored and later rendered, so both are accepted only as http or https. The
canonical link falls back to the URL that was requested.

### Two parsers, one vocabulary

The fetcher owns ingredient lines. It reads `1 lb 2 oz` as `1.125 lb`, which
`parseQuantity` cannot: that one stops at the first number. `quantity.ts` keeps
owning the measurements inside step prose, which a parser trained on ingredient
sentences cannot read.

So `Unit` spans two languages, and disagreement there is silent rather than
loud — a unit one side produces and the other does not would never compare
equal to the same amount found in a step, and the ingredient would quietly stop
rescaling with it. Three things hold it together:

- the fetcher may emit only units `parseQuantity` can also produce, which is
  what `isUnit` is;
- an amount arriving already parsed is validated like any other input, and
  anything unusable falls back to reading the text;
- `units.json` is a data file precisely so tests on both sides read it.

## Photo

```sh
curl -X POST http://localhost:3000/api/extract/photo   -b 'your-session-cookie'   -F 'file=@page.jpg'
```

Request: `multipart/form-data` with a `file` part, at most 10 000 000 bytes.
Response: the same `{ "recipe": { … } }` as above.

| Status | Meaning |
|---|---|
| 401 | No session |
| 415 | Body is not multipart, or the file is not an image this service can read |
| 400 | Body is malformed multipart, or the `file` part is missing or empty |
| 413 | The upload is over the byte limit, or its reading exceeds 20 000 characters |
| 422 | No text could be read from the image, or the model found no recipe in it |
| 502 | Either service was unreachable, failed, or answered with something unusable |
| 504 | The OCR service took over two minutes, or Ollama over five |

**Two services, in order.** The OCR service turns the image into text and the
same model the text pipeline uses turns that text into a recipe. No image ever
reaches Ollama — sending the photo to a vision model is what took 4m 5s, and
reading it first costs about a second.

This is why photo import is an ordinary request rather than a job and a poll:
it now costs what the text path costs, which is the argument that already
retired the poll for websites.

Unlike the website path, the OCR service's 415 is passed through as a 415. A URL
serving a PDF is a problem with what the caller asked for; an upload that is not
an image is a problem with the body they sent.

The prompt adds two lines to the text pipeline's, saying what is true of a
photograph: that line breaks may fall mid-sentence, and that a page number or a
caption is neither an ingredient nor a step. It does not ask the model to
correct the reading. An OCR slip left visible is better than one invented into
something plausible.

Nothing stores the image, so `source.objectKey` is null and only the filename
the browser sent is recorded. Object storage is what fills it in; see
[planning](./planning.md).

## The pipeline

Four steps, in `server/extraction/`, behind the barrel at
`server/utils/extraction.ts`. A modality reads its own input and builds its own
source; everything below that is shared.

1. **`readExtractionText`** — content type, JSON parse, then `validateText`
   for presence and length. The text is passed on unmodified; whitespace only
   decides whether it is empty.
2. **`askOllama`** — the transport, shared by every input modality: one
   `/api/chat` call with `stream: false`, `think: false`, `temperature: 0` and a
   JSON schema in `format`. Rejects a truncated answer (`done_reason: "length"`)
   even when it parses, and sanitizes every upstream failure.
   **`extractText`** is the text modality on top of it — it builds the messages,
   keeping the source as its own user message rather than interpolating it into
   the instructions, and records a `RecipeSource` of `type: "text"`.
   **`extractPhoto`** is the same shape with a hop in front: `askOcr` posts the
   upload to the OCR service, and the reading it returns becomes the user
   message. The prompt and the source differ; the transport does not.
3. **`parseExtraction`** — validates and clamps, then assigns IDs.
4. **`normalizeRecipe`** — reads quantities into numbers and units, finds
   measurements in step prose, and links steps back to ingredients. A source
   that read an amount itself keeps its reading; everything else is read out of
   the segmented text here.

### What the model is asked for, and what it is not

The schema lives in `server/extraction/recipe-draft.schema.json`, its own file
because that is what it is — the artifact Ollama compiles into a llama.cpp
grammar. It constrains generation to a recipe object and to taking each
ingredient line apart into an amount, a food and whatever else the line says,
with the line copied verbatim first: property order is generation order under a
grammar.

What a page supplies but a paste cannot — an image, a canonical link, a site
name — is deliberately absent from it, and so is `parsedQuantity`, which is the
fetcher's to send. The model is never asked to invent one.

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
  image: string | null          // a page's own; null for every other source
  totalTime: number | null      // minutes, likewise
  ingredients: Ingredient[]
  steps: Step[]
  source: RecipeSource
}

type RecipeSource =
  | { type: 'text', originalText: string }
  | { type: 'website', url: string, author: string | null, siteName: string | null, retrievedAt: string }
  | { type: 'photo', objectKey: string | null, originalFilename: string | null }

type Ingredient = {
  id: string                    // "ingredient_1", dense and stable
  originalText: string          // the line, verbatim
  name: string                  // the food alone; falls back to the line
  quantityText: string | null   // the amount alone, as the source split it
  quantity: Quantity | null     // parsed; null when the line states no amount
  extra: string | null          // "finely diced", "for the sauce"
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
  | { type: 'ingredientQuantity', ingredientId: string }  // an ingredient's own amount

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

Twenty-six cases over the whole pipeline with no browser, no model and no
service running: a fake `fetch` covers all three upstream contracts and their
failure modes, and quantity parsing and normalization are pure functions. One case
asserts that every reference in a normalized recipe resolves — worth keeping as
the matching rules change. Another reads the fetcher's `units.json` and checks
it against this side's table, which is the only guard against that drift.

Each service has its own suite:

```sh
cd services/recipeat-fetcher && uv run pytest
cd services/recipeat-ocr && uv run pytest      # no model is loaded
```

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
| Full-resolution photo, through a vision model | 4m 5s |

Those numbers are why the text request timeout is five minutes. They are also
why neither of the other two modalities goes through the model as it stands:
the same page read by `recipe-scrapers` and `ingredient-parser` is a matter of
seconds, and a photo is now read by OCR before the model sees anything.

Those VPS figures predate the switch to `qwen3.5:2b` and were taken with the 4b;
nothing has re-measured them since. What has been measured is the whole stack in
containers on a developer machine, which is slower per token than the VPS and
says nothing about it directly:

| Source | Time |
|---|---|
| Short German recipe, pasted | 1m 29s |
| The same recipe as a 3024x4032 photo | 1m 36s |
| — of which OCR | 3.5s |
| The same photo at 680x460 | 1.0s of OCR |

The gap between the two rows is the whole cost of reading a photo. `OCR_MAX_SIDE_LEN`
caps the longer side at 2000 pixels, so a bigger photo costs the downscale and
not the pixels.
