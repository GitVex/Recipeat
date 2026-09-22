# Planning

Where Recipeat is, what comes next, and which decisions are still open.

```
text ──────▶ model ──┐
photo ─────▶ model ──┼─▶ validate ─▶ normalize ─▶ [ store ] ─▶ [ collection UI ]
url ──────▶ fetcher ─┘
   ══════════════════ done ════════════════════════════   ▲ next
```

## State

| Area | Status |
|---|---|
| Landing page, recipe demo | Done; collection is browser-local, not per account |
| Zitadel login | Done |
| Extraction model | Done; Gemini, billed per page. Was a self-hosted Ollama until the photo path needed a model that could read a page |
| `POST /api/extract/text` | Done; returns a recipe, stores nothing |
| Storage | Not started — no database, driver, or migration |
| Import UI wired to the API | Not started — the dialog still shows samples |
| Website import | Done; returns a recipe, stores nothing. No SSRF guard yet |
| Photo import | Done; the model reads the photo directly, returns a recipe, stores nothing. The image itself is discarded |

## Next: storage

The extraction output already maps onto the table one-to-one, and satisfies
every constraint by construction. Only `owner_sub` is missing, and the route
already holds it — `session.claims.sub`.

```sql
CREATE TABLE recipes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_sub TEXT NOT NULL,
    title TEXT,
    source_lang TEXT NOT NULL,
    ingredients JSONB NOT NULL,
    steps JSONB NOT NULL,
    portions NUMERIC,
    source JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CHECK (portions IS NULL OR portions > 0),
    CHECK (jsonb_typeof(ingredients) = 'array'),
    CHECK (jsonb_typeof(steps) = 'array'),
    CHECK (source IS NULL OR jsonb_typeof(source) = 'object')
);

CREATE INDEX recipes_owner_recent_idx ON recipes (owner_sub, created_at DESC);
```

`owner_sub` has no foreign key on purpose: users live in Zitadel. The index is
composite because the listing query is always
`WHERE owner_sub = $1 ORDER BY created_at DESC`.

`updated_at` still needs a `BEFORE UPDATE` trigger — the default fires only on
insert, so without one the column never changes.

`source` is JSONB rather than TEXT so a website import can record its URL and
retrieval time, and a photo import its object key. The `RecipeSource` union
already exists in code; each extraction modality builds its own, since only it
knows where the recipe came from.

Work involved: a Postgres service of its own under `docker/`, a
connection URL in `runtimeConfig`, a driver (`postgres` handles JSONB natively
and needs no query builder here), a real `.sql` migration, and `owner_sub` read
from the session.

### Open decision: does extraction save?

Keeping them separate fits the existing UX — `RecipeImportDialog` previews
before anything joins the collection — and keeps bad extractions out of the
table. `POST /api/extract/text` would stay as it is, and a new `POST /api/recipes`
would persist.

The catch: a draft coming back from the browser is untrusted input, so the save
endpoint needs its own validation. `parseExtraction` cannot be reused for it —
that one expects model output. The alternative is to hold the draft server-side
under an ID and have the client confirm by ID, so the recipe never round-trips
through the browser. More moving parts, nothing to re-validate.

## Then

**Wire the import dialog.** `RecipeImportDialog.vue` fakes extraction with a
`setTimeout` and emits a sample. Real wiring needs a pending state that
tolerates 20+ seconds, and error copy for 422 and 504. The recipe card must also
handle a `null` title and an empty step list — an ingredients-only extraction is
valid.

**One type for a recipe.** `app/types/recipe.ts` is a separate, incompatible
shape with `category`, `time` and `image` fields that the extraction has no
equivalent for. The app and the server should share one definition, and the
table needs somewhere to put an image before a saved recipe can render like the
demo does.

**Photo import: the image itself.** Extraction works, but nothing keeps the
photo. `source.objectKey` is null because there is nowhere to put it, and a
recipe imported from a photo therefore cannot show the photo. That needs object
storage and a downsampled derivative. Nothing downsamples today: the upload is
forwarded to the model as it arrived.

The argument for a job and a poll is gone either way — a photo is read in five
to nine seconds, which is the whole request.

**Translation.** `source_lang` is recorded but there is nowhere to put a
translation. Either a `translations JSONB` keyed by language tag, or a
`recipe_translations` table.

## Known rough edges

- **A photo of several pages.** `MAX_PHOTO_BYTES` is a size limit, not a page
  count, and nothing rejects a photograph of a spread. What comes back is one
  recipe assembled out of two, which is worse than a refusal because it looks
  like a result.
- **How well the page was read is invisible to the app.** The model returns a
  recipe and nothing about its own confidence, so a blurry photo and a clean
  one are indistinguishable downstream. The OCR service used to give a
  per-line confidence that was also dropped; now there is nothing to drop.
  Showing the source line beside each ingredient is the affordance that
  survives — `originalText` is already stored for exactly that.
- **No SSRF guard.** The fetcher resolves no addresses and follows a redirect
  wherever it points, so a URL given to it reaches anything its container can.
  It runs as its own Compose project to keep that blast radius small, which is
  a mitigation and not the fix. The fix is to resolve each hop and reject
  private, loopback and link-local addresses before connecting.
- **One `Unit`, two languages.** The fetcher emits `Unit` values directly, and
  may only emit ones `parseQuantity` could also produce. Where the two
  disagree nothing throws — `normalizeRecipe` simply stops linking a step's
  amount to the ingredient it restates. A test reading the service's unit map
  is what keeps them honest.
- **Rate limits are someone else's now.** Nothing queues in front of the model,
  and a burst answers 503 from `gemini.ts` rather than waiting. That is better
  than the single-slot Ollama it replaced, but the app still shows the user a
  failure where a retry would do.
- **Unit ambiguity.** `cup`, `tbsp`, `tsp` and `fl_oz` are stored unresolved
  because a line cannot say whether it means US or metric. Display has to pick,
  probably from `source_lang`. `c` is disambiguated by magnitude: below 90 it is
  a cup, at or above it is Celsius.
- **Ingredient linking.** Matching falls back to the head noun, so two
  ingredients sharing a noun and an amount — `"1 cup white sugar"` and
  `"1 cup brown sugar"` in one step — are separated only by proximity.
- **Dedupe.** Re-importing the same URL will create a second row. A partial
  unique index on `(owner_sub, (source->>'url'))` would catch it, and the
  canonical URL the fetcher returns is the better key to store there.
- **Extraction leaves the host.** Every text and photo import is a request to
  Google. The fetcher already reaches the internet, but it reaches a page the
  user named; this sends the user's own recipes. Billing is required rather
  than optional: the free tier is not licensed for an API client serving users
  in the EEA.
- **Step numbering comes back inside the step.** The model returns
  `"1. Gurken längsweise vierteln."`, numbering included, and at least one page
  folded two steps into one and left a gap in the sequence. Worth deciding
  whether the prompt should strip the numbers or the UI should stop adding
  its own.
