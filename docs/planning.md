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
| `POST /api/recipes` | Done; writes a recipe to the table, owned by the session's subject |
| Save, progression, variant | Done; the three write routes, with the pin moving on a progression |
| Storage | Done; Postgres, the `recipes` table, a migration runner, and every route the collection needs. Nothing in the browser calls them yet |
| Import UI wired to the API | Done for the shared part (#36): all three tabs call their route and open what comes back. Per-source polish is #37–#39. An import can be added to the collection (#41) |
| Website import | Done; returns a recipe, stores nothing. No SSRF guard yet |
| Photo import | Done; the model reads the photo directly, returns a recipe, stores nothing. The image itself is discarded |

## Next: storage

The extraction output already maps onto the table one-to-one, and satisfies
every constraint by construction. Only `owner_sub` is missing, and the route
already holds it — `session.claims.sub`.

The table is [`server/database/migrations/001_recipes.sql`](../server/database/migrations/001_recipes.sql)
— committed SQL rather than a sketch here, so there is one place to read
it and one place to get it wrong. What follows is why it looks like that.

`owner_sub` has no foreign key on purpose: users live in Zitadel. The listing
index is composite because the query is always
`WHERE owner_sub = $1 AND pinned ORDER BY created_at DESC`, and partial
because an unpinned version is never in a listing.

The four lineage columns are explained under "Recipe lineage" below. They went
into the first migration rather than a second one, which was free only while
nothing had been applied anywhere (#28).

`updated_at` gets a `BEFORE UPDATE` trigger, because the default fires only on
insert and without one the column would never change. `line_id` gets a
`BEFORE INSERT` one, so a root row can be written without generating its UUID
on the client in order to use it twice.

`source` is JSONB rather than TEXT so a website import can record its URL and
retrieval time, and a photo import its object key. The `RecipeSource` union
already exists in code; each extraction modality builds its own, since only it
knows where the recipe came from.

The service, the driver, the connection URL and the migration runner are done
— see [database.md](database.md), and the routes that write and read are in
`server/api/recipes*`. What is left is the app: nothing in the browser calls
any of them yet.

### Decided: extraction does not save

`POST /api/extract/*` still stores nothing, and `POST /api/recipes` persists —
which keeps the preview `RecipeImportDialog` already does, keeps a bad
extraction out of the table, and is the only shape in which a person can
correct a recipe before it joins their collection.

The cost is that a draft comes back through the browser as untrusted input,
and `parseExtraction` cannot check it: that one is written for model output and
recovers rather than rejects. So `validateRecipe` does, and it refuses instead
— a browser sending a malformed recipe is our own bug, not a flaky model.

Holding the draft server-side under an ID was the alternative, and it buys less
than it looks like. The three write endpoints in #29 all take an edited recipe
body, so a validator for untrusted recipes has to exist regardless; a draft
store would remove it from one path out of four and add a cache with a
lifetime.

What the validator produces is a draft, not a recipe. Ingredient ids, step
parts and the links between them are rebuilt by the same assembly extraction
runs, so a stored recipe and an extracted one are the same shape by
construction and nothing structural arrives from outside.

## Then

**Finish the import dialog.** It calls all three routes through
`useExtraction`, which turns every status into something a person can act on.
What is left is specific to each source: URL fix-ups (#37), the text limit and
its counter (#38), a thumbnail, HEIC and the byte limit for photos (#39). An
extracted recipe can be added to the collection, but the shelf does not list
the collection yet.

**One type for a recipe.** Settled: `shared/types/recipe.ts` is the one
definition, and the server re-exports it rather than restating it. The shelf's
samples are written in it too. What rendering it fully takes — step parts,
rescaling, units — is still #12.

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

## Recipe lineage

Three save actions, and the difference between them decides the schema before
it decides any UI. The definitions, settled in #23:

- **Save** — overwrite in place. The recipe you had, corrected. Same row, same
  id, and it works on any version, not only the current one.
- **Save as Progression** — a new version in a line. The same recipe, further
  along; you are iterating and the history is the point.
- **Save as Variant** — a branch. A different take that stands on its own and
  is not trying to replace the original.

Three endpoints rather than one taking the action as a parameter (#29):
`PUT /api/recipes/{id}` saves, `POST /api/recipes/{id}/progressions` extends a
line, `POST /api/recipes/{id}/variants` leaves it. The payload is the same
recipe either way, but only one of the three overwrites, and it is the only one
that is not a POST — the destructive action cannot be reached by posting
somewhere.

### The pin

A line of progressions is a tree, not a list. A progression can be made from
any version, so a version can have several progression children, and something
has to say which one the app means when it says "the recipe". That is the pin:
the entry point, what the collection and every menu show, and the only version
reachable without going through the lineage view.

Making a progression moves the pin to it, wherever in the tree it was made
from. That is the whole rule — no exception for progressing off an old version
— and it makes the pin always the thing last worked on. It also means the
lineage view needs a pin button, or a version reached by going backwards could
only become the entry point by progressing off it again.

One pin per line, held as a partial unique index rather than by three write
endpoints each remembering to unpin the old one. The endpoint that inserts a
progression unpins and inserts in one transaction.

### Variants

A variant leaves the line. It points at the version it branched off and becomes
the first version of a line of its own, with its own pin and its own tree. A
lineage view shows a recipe's own progressions in full and its variants only as
far as their entry point: a variant is a different recipe, and its history is
its own business.

### Progressions are copies

A progression stores the whole recipe, not a delta. Reading a version is one
row, a diff between two is a comparison of two rows, and the cost is that a
line of thirty progressions is thirty recipes on disk — which, for text, is
less than the alternative costs in complexity.

The consequence to be honest about: editing an earlier version does not reach
the versions made from it. Fixing a typo three versions back leaves the pinned
version still carrying it. That is inherent in copies rather than deltas, and
is accepted; the UI's job is to not imply otherwise.

### Deleting

Deletions cascade along progressions and stop at variants. Deleting a version
takes every progression descended from it; a variant that branched off it
survives, having become its own recipe, and keeps no reference to where it came
from.

Most deletions are not that. The common one is deleting the pinned version,
which is usually a leaf, and the pin reverts to its parent. A deletion that
takes other versions with it has to say so before it runs — the count is
knowable first.

A single parent column cannot express "cascade to progressions, not to
variants": `ON DELETE` applies to every child a foreign key has. Two columns
can, and they make a separate kind column unnecessary — which of the two is set
*is* the kind. Hence `progression_of` and `variant_of`, each a composite
foreign key carrying `owner_sub`, which is what makes lineage across two owners
fail in the schema rather than in whichever route forgot to check.

`line_id` is the tree's identity: a root and every variant is its own, and a
progression inherits its parent's. It never needs rewriting, because cascade
means no progression outlives its ancestors. With it the collection listing is
`WHERE owner_sub = $1 AND pinned ORDER BY created_at DESC` — the composite
index becomes a partial one — and a lineage view is an index scan rather than a
recursive CTE.

The unique index stops a second pin; nothing stops a line having none, so the
write paths own that half of the invariant.

Still open: whether a `version INT` is worth carrying. It is derivable from the
tree, can disagree with it, and earns itself only if the UI shows a number
(#28).

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
- **Dedupe is a non-goal.** Re-importing the same URL makes a second recipe,
  deliberately. The partial unique index on `(owner_sub, (source->>'url'))`
  that would catch it cannot be written as it stands: every progression copies
  `source`, so the second version of any website recipe would collide with the
  first. Restricted to rows that are neither a progression nor a variant it
  would work, and it is still not wanted — re-importing a page is a way to
  start again from it.
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
