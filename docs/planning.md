# Planning

Where Recipeat is, what comes next, and which decisions are still open.

```
text ─▶ extract ─▶ validate ─▶ normalize ─▶ [ store ] ─▶ [ collection UI ]
        ══════════ done ══════════════════   ▲ next
```

## State

| Area | Status |
|---|---|
| Landing page, recipe demo | Done; collection is browser-local, not per account |
| Zitadel login | Done |
| Ollama on the VPS | Done |
| `POST /api/extract/text` | Done; returns a recipe, stores nothing |
| Storage | Not started — no database, driver, or migration |
| Import UI wired to the API | Not started — the dialog still shows samples |
| Website import | In progress — the fetcher service is scaffolded, nothing is wired up |
| Photo import | Not started |

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

Work involved: a Postgres service alongside the Ollama compose file, a
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

**Website import.** A URL goes to
[`recipeat-fetcher`](../services/recipeat-fetcher/), a small Python service
beside Ollama: `recipe-scrapers` reads the page's structured data and
`ingredient-parser` splits each ingredient line into an amount and a food. Both
are deterministic, so no model runs, and the import is quick enough for an
ordinary `POST /api/extract/website` rather than a job and a poll. The service
fetches the page itself behind an SSRF guard instead of letting a library open
the socket, and returns the draft shape `parseExtraction` already takes, so the
pipeline below it is unchanged.

It owns ingredient lines only. `quantity.ts` keeps reading measurements out of
step prose, which a parser trained on ingredient sentences cannot do.

**Photo import.** Still the slow one at 4m, so the job-and-poll argument stands
there. Photos also need object storage and downsampling; full resolution is what
makes them slow.

**Translation.** `source_lang` is recorded but there is nowhere to put a
translation. Either a `translations JSONB` keyed by language tag, or a
`recipe_translations` table.

## Known rough edges

- **Timeout versus large sources.** The request timeout is five minutes, and a
  full 20 000-character paste may still exceed it. Raising the timeout makes it
  succeed but leaves a browser hanging for ten minutes, which is the real
  argument for the job-and-poll design. Website import no longer runs through
  the model, so this is now about long text and photos.
- **One `Unit`, two languages.** The fetcher emits `Unit` values directly, and
  may only emit ones `parseQuantity` could also produce. Where the two
  disagree nothing throws — `normalizeRecipe` simply stops linking a step's
  amount to the ingredient it restates. A test reading the service's unit map
  is what keeps them honest.
- **Concurrency.** `OLLAMA_NUM_PARALLEL` is 1 and nothing queues in front of it,
  so a second user waits with no feedback. An in-process mutex should either
  queue or return 429.
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
- **Model tag.** `qwen3.5:4b` is pulled and requested by name in two places.
  Confirm a tag exists before changing it; a failed pull leaves a healthy server
  with no model.
