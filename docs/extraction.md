# Extraction

Three endpoints, one recipe shape. All require a session and store nothing, so
an extraction can be previewed before it is kept.

| | |
|---|---|
| `POST /api/extract/text` | Pasted text, read by the model |
| `POST /api/extract/website` | A URL, read by the [fetcher](../services/recipeat-fetcher/README.md) with no model at all |
| `POST /api/extract/photo` | A photo, read by the model directly |

## Text

```sh
curl -X POST http://localhost:8100/api/extract/text \
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
| 502 | The model was unreachable, failed, or answered with something unusable |
| 503 | The model is busy or the deployment is over its quota; the request can be retried |
| 504 | The model did not answer within a minute |

Client-facing messages are sanitized. The detail — upstream response bodies,
host names, stack traces — rides on the error's `cause`, which Nitro logs
server-side and never serializes to the client.

## Website

```sh
curl -X POST http://localhost:8100/api/extract/website \
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
| 422 | The page holds no recipe, or the URL serves something that is not a page |
| 502 | The site failed or was unreachable, or the fetcher could not be reached |
| 504 | The site did not answer in time |

**No model runs on this path.** `recipe-scrapers` reads the page's structured
data and `ingredient-parser` segments each ingredient line, both
deterministically. A page that took 2m 17s through the model takes seconds, which
is why this is an ordinary request and not a job and a poll.

### Which sites work

Any site can be tried; none is refused for its address. How a page is read
depends on its host:

- **A supported site.** `recipe-scrapers` has a scraper written for the host,
  over 700 of them, and reads the page with it. This is the reliable case.
  Matching is on the host with a leading `www.` removed, and nothing else: a
  country variant is supported only if it is on the list itself
  (`bbcgoodfood.com` is, a subdomain of it is not).
- **Any other site with recipe markup.** The fetcher falls back to the page's
  schema.org `Recipe` data, the JSON-LD most food blogs publish for search
  engines. It usually works, but nothing guarantees how complete the markup
  is: a field the page leaves out arrives as null.
- **Neither.** A page with no `Recipe` markup is a 422, found out only after
  the page was fetched.

The fallback is asked for (`supported_only=False`) rather than left to the
library's default, which is to refuse an unknown host; an upgrade that moves the
default cannot change which sites work.

The import dialog says which of the first two a link is while it is typed,
from the fetcher's list (`GET /api/extract/sites`) and without fetching the
page: "Supported", or "Not on the supported list, so we'll try reading the
page's recipe markup". It never blocks a link. When an unlisted page turns out
to have no recipe, the 422 is shown in the hint's words, so the failure is
the thing the hint said would be tried. The whole list is at `/sites`.
Matching is in `shared/utils/siteSupport.ts`.

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
curl -X POST http://localhost:8100/api/extract/photo   -b 'your-session-cookie'   -F 'file=@page.jpg'
```

Request: `multipart/form-data` with a `file` part, at most 10 000 000 bytes.
Response: the same `{ "recipe": { … } }` as above.

| Status | Meaning |
|---|---|
| 401 | No session |
| 415 | Body is not multipart |
| 400 | Body is malformed multipart, or the `file` part is missing or empty |
| 413 | The upload is over the byte limit |
| 422 | The model found no recipe in the photograph |
| 502 | The model was unreachable, failed, or answered with something unusable |
| 503 | The model is busy or the deployment is over its quota; the request can be retried |
| 504 | The model did not answer within a minute |

**One call.** The model is shown the photograph and answers with the recipe.
Nothing between the upload and the model decodes the image, reads it, or
decides what the page's layout was.

It did not start this way. Photo import ran through a self-hosted OCR service
that turned the page into text, and a local model that read the text — two
containers, about eighty seconds, and a recursive XY-cut that tried to work out
where a page's columns were before the model ever saw it. On ten photographs of
handwritten cards that pipeline lost every quantity and collapsed two pages to
two ingredients each. The same ten read directly take five to nine seconds and
come back with the amounts intact. The layout problem did not get solved; it
stopped existing.

The cost is that extraction now leaves the host. See
[planning](./planning.md).

The prompt adds three lines to the text pipeline's, saying what is true of a
photograph: that it may be handwritten and set in columns, that columns are
read in their own order rather than straight across, and that a page number or
a caption is neither an ingredient nor a step. Quantities are called out
specifically — a misread amount becomes a wrong recipe, where a misread word
stays a typo.

Extraction stores nothing, so only the filename the browser sent is recorded.
Keeping the picture is the import dialog's choice, made once the recipe is
saved: it becomes the line's source image (#45), not a field on the source.

## Instagram

```sh
curl -X POST http://localhost:8100/api/extract/website   -b 'your-session-cookie'   -H 'Content-Type: application/json'   -d '{"url":"https://www.instagram.com/p/DbXWEUaxWVd/"}'
```

A link to an Instagram post is a website import (#120): same route, same
`{ "recipe": { … } }`. Statuses are in the [API map](./api-map.md). The source
is a website source with a `post: { url, author }` crediting the post, and the
library files it under websites.

A post has no recipe markup, so it is read in this order, and the first that
finds a recipe wins:

1. **A page the caption links to** (#122), through the website import above.
   Up to three `http(s)://` or `www.` links, in order, Instagram's own skipped.
   The recipe is the page's, and `post` credits where the link was found. A
   page without a recipe, or one that can't be read, moves on to the next.
2. **The caption and images**, through the model. The import dialog's hint asks
   for the recipe's own link first, since that reads more reliably than this
   (#121).

Still to come, each its own plan: the creator's site found through the bio
link (#123), and a reel's audio as a last resort (#124).

In step 2 the caption and the post's images go to the model together, in one
call, since these recipes are routinely split across the two. The prompt adds that the caption comes first
and the images after it in order, that hashtags and calls to follow are not the
recipe, and that a picture of the finished dish is neither ingredient nor step.
A video contributes its cover image; nothing watches the video.

**How a post is read: scraped, logged out (#111).** The fetcher reads a post
with [instaloader](https://instaloader.github.io/) and no account.

- **Official API: none that fits.** The Basic Display API was shut down in
  December 2024, and the Graph API reads the media of the business or creator
  account that authorised it, not somebody else's public post.
- **Terms of service.** Instagram's terms forbid automated collection, and this
  is that. What it risks is the fetcher's address being rate-limited or
  blocked, not an account, because there is none to ban.
- **Authentication.** None, and none is stored. A logged-in scraper
  (instagrapi) would be more reliable, but would need an account's session as a
  deployment secret and could get that account banned.
- **What works logged out, as of 2026-09-30.** One post by its URL: caption,
  author and media URLs, several times in a row. A profile lookup was refused
  on the first request (`401 Please wait a few minutes`), so scanning a profile
  logged out is not a route even before it is a design question.
- **What breaks it.** Instagram changing its private endpoints, or throttling
  the fetcher's address. Either arrives as a failed fetch, and the text and
  photo tabs remain a way in: paste the caption, or add a screenshot.

Private posts are out of scope: reading them needs the user's own Instagram
session, which is a different trust relationship from anything Recipeat holds
today. Scanning a profile for new recipes is its own plan (#116).

Images come from `*.cdninstagram.com`. The fetcher requests only Instagram's own
hosts for them, including for media URLs the post itself names, and under that
allowlist the SSRF guard (#117) refuses any non-public address. Caption links go
through the same guarded website fetch as any pasted link: a post's author
chooses them, which is what #117 was written for.

## The pipeline

Four steps, in `server/extraction/`, behind the barrel at
`server/utils/extraction.ts`. A modality reads its own input and builds its own
source; everything below that is shared.

1. **`readExtractionText`** — content type, JSON parse, then `validateText`
   for presence and length. The text is passed on unmodified; whitespace only
   decides whether it is empty.
2. **`askGemini`** — the transport, shared by both model-backed modalities: one
   `/v1beta/interactions` call at `temperature: 0`, thinking low, `store: false`
   and the JSON schema in `response_format`. Rejects an answer whose `status` is
   not `completed` even when it parses, and sanitizes every upstream failure.
   **`extractText`** is the text modality on top of it — the source is its own
   part rather than interpolated into the instructions, and it records a
   `RecipeSource` of `type: "text"`.
   **`extractPhoto`** is the same call with an image part instead of a text one.
   The prompt and the source differ; the transport does not.
3. **`parseExtraction`** — validates and clamps, then assigns IDs.
4. **`normalizeRecipe`** — reads quantities into numbers and units, finds
   measurements in step prose, and links steps back to ingredients. A source
   that read an amount itself keeps its reading; everything else is read out of
   the segmented text here. Each ingredient is also matched against the
   ingredient table (below) and given its amount in grams or millilitres.

### What the model is asked for, and what it is not

The schema lives in `server/extraction/recipe-draft.schema.json`, its own file
because that is what it is — the artifact that constrains generation. It holds
the answer to a recipe object and takes each ingredient line apart into an
amount, a food and whatever else the line says, with the line copied verbatim
first.

That last part used to be structural. Under llama.cpp's grammar, property order
was generation order, so `originalText` preceding `quantity` guaranteed the line
was copied before it was taken apart. The hosted model makes no such promise, so
the ordering is a hint and the system prompt carries the instruction.

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
  | { type: 'website', url: string, author: string | null, siteName: string | null, retrievedAt: string,
      post?: { url: string, author: string | null } }  // through an Instagram post
  | { type: 'photo', originalFilename: string | null }

type Ingredient = {
  id: string                    // "ingredient_1", dense and stable
  originalText: string          // the line, verbatim
  name: string                  // the food alone; falls back to the line
  quantityText: string | null   // the amount alone, as the source split it
  quantity: Quantity | null     // parsed; null when the line states no amount
  extra: string | null          // "finely diced", "for the sauce"
  food?: { key: string, gramsPerMl: number | null } | null  // its ingredient table entry
  canonical?: Quantity | null   // grams for a solid, ml for a liquid
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

## The ingredient table

`server/extraction/ingredients.json` lists about 420 common ingredients (#132).
Each has a key, English and German names, whether it's a solid or a liquid,
and how many grams a millilitre of it weighs. Normalization matches an
ingredient's `name` against it and stores two things beside the quantity: the
matched `food`, and the amount as `canonical`, in grams for a solid and
millilitres for a liquid. "1 cup flour" and "125 g flour" then add up, which
is what a shopping list (#84) and substitutions (#43) need.

The quantity as written is still the truth. `canonical` is derived, rebuilt on
every save like the step parts, and never accepted from a client. A recipe
stored before the table existed has neither field until it's saved again, or
until #53 re-normalizes stored recipes.

**Matching** is by name: the recipe's language first, then the other one,
since English names turn up in German recipes. Accents, case and anything in
parentheses don't matter. Each part between commas is tried in turn, since the
food usually comes first ("butter, softened") but not always ("bone-in,
skin-on chicken thighs"). Leading words that only describe the ingredient are dropped one at a time
("2 large eggs", "frischer Ingwer"). Words that make it a different food
("dried", "ground", "canned", "cooked") are not, so "cooked rice" and "almond
milk" match nothing rather than "rice" and "milk". English plurals match their
singular; German plurals are listed, since no rule covers Ei/Eier and
Zwiebel/Zwiebeln alike.

**Densities** come from [USDA FoodData Central](https://fdc.nal.usda.gov/),
SR Legacy: the household portions it lists for each food ("1 cup = 125 g"),
which were weighed rather than estimated. A cup is preferred to a spoon, being
measured more precisely, and where the first cup listed is the wrong one
("1 cup, whipped" for cream) the entry names the right one in `pick`. Foods
bought by the piece, most meat and fish, have no density: their weights
convert, and a volume of them doesn't. FoodData Central is public domain
(CC0); USDA asks to be named as the source.

A few common foods aren't in FoodData Central at all: Quark, crème fraîche,
Vanillezucker, paneer, harissa, garam masala, the ginger and garlic pastes.
They have `fdcId: null`, a key and names, and no density. They still match and
merge by key, and a weight of them converts like any other.

The keys, FDC ids and names are written by hand. The FDC description, the
portion and the density are filled in by a script, so a new FDC release is one
rerun. It also refuses a key used twice, or one name given to two foods in the
same language:

```sh
# SR Legacy as CSV, from https://fdc.nal.usda.gov/download-datasets
node --experimental-strip-types scripts/ingredients.ts <unzipped folder>
```

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
```

The auth suite covers the endpoint's 401 and its validation.

For a live check, sign in and call it from the devtools console so the session
cookie comes along:

```js
await (await fetch('/api/extract/text', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ text: '2 eggs, beaten.\nFry them in butter.' }),
})).json()
```

Measured over ten photographs of handwritten recipe cards, 1536x2048 and
2048x1536:

| | |
|---|---|
| Photo, end to end | 4.5-9.0s, mean 6.1s |
| Tokens for one page | ~1 060 in, ~1 000 out |
| Cost | $4.66 per 1 000 pages |

The request timeout is a minute, which is an order of magnitude over the
slowest of those. Website import still does not go through the model at all:
`recipe-scrapers` and `ingredient-parser` answer the same page in seconds and
deterministically.

For comparison, the same ten pages through the self-hosted pipeline this
replaced — an OCR container plus `qwen3.5:2b` — took 21.6s to 88.4s, returned
no quantities at all, and reduced two of the landscape cards to two ingredients
each.
