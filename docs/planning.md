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
| Website import | Done; returns a recipe, stores nothing. The fetcher only reaches public addresses (#117) |
| Photo import | Done; the model reads a 1600 px copy of the photo (#40), returns a recipe, stores nothing. The picture can be kept with the recipe once it is saved (#45) |
| Images | Done (#45): dish photos per version and a line's source photo, as `BYTEA` in Postgres, served only through `/api/images/{id}` |
| Instagram import | Done for one public post (#22), as a kind of website import (#120): pasted in the Website tab, read logged out by the fetcher, caption links tried first (#122), then caption and images to the model together. The creator's site is #123, reel audio #124, profile scanning #116 |

## Waves

Work is scheduled in Waves, one GitHub milestone each (`Wave N`). The
**current Wave** is the lowest-numbered open one.

- **Features.** A Wave holds at most **4 top-level features**: issues that are
  not bugs, not chores and have no parent issue. Sub-issues of those features don't count
  and belong in the same Wave.
- **Migrations.** At most **one** issue in a Wave, bugs included, may add a
  database migration. Issues that will are labelled `needs:migration` when
  written.
- **Dependencies.** A feature goes in a later Wave than every issue it depends
  on.
- **Plans.** An issue titled `Plan:` lives in the *Plans* milestone, never in a
  Wave. It says in its body which Wave it is aiming for ("Aiming for: Wave 4").
  Once its questions are answered here, the implementation issues it produces
  enter a Wave, and the Plan is closed or becomes their parent.
- **Bugs** go into the current Wave when filed, and don't count toward the
  feature limit. A bug in a feature that hasn't shipped goes into that
  feature's Wave. *Bug Hell* is for bugs that need an earlier decision
  revisited; only the maintainer moves a bug there.
- **Closing.** A Wave closes when its features are closed. Open bugs and chores
  move to the next Wave.
- **Full Waves.** When a feature doesn't fit, it goes into the next Wave that
  has room, opening a new one if none does.

### Issue Types

- **Plan:** A plan is a one-line summary of a feature or task. It is a title only or a quick description.
- **Bug:** A bug is a problem or issue that needs to be fixed.
- **Chore:** A chore is a task that needs to be done but is not a feature.
- **Feature:** A feature is a new or existing functionality that needs to be implemented.

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
samples are written in it too. It renders through `shared/utils/recipeText.ts`:
amounts from the parsed quantities, steps from their parts, and a restated
amount from the ingredient it points at, so #44 has one number to rescale.
An amount whose unit the parser did not know ("4 TL", "2 Zehen") prints as
written rather than as a bare number.

**Photo import: the image itself.** The argument for a job and a poll is
gone — a photo is read in five to nine seconds, which is the whole request.
Settled in #40: the model is sent the 1600 px JPEG a kept photo is stored as,
made in the browser, not the upload as it arrived. On 18 cookbook pages it
read amounts as well as the 2048 px originals (one smudged amount dropped,
against two misread by each run of the original), while 1200 px and below
misread three to five. Gemini counts an image at 1064 tokens whatever its
size, so this saves upload, not cost. `MAX_PHOTO_BYTES` stays, as a guard
against a request that skipped the browser rather than a limit a person
meets. Not yet tried against a phone's full 4032 px; the test photos were
all 2048 px.

### Decided: images live in Postgres (#45)

No object store. Images are rows in `images`, bytes in `BYTEA`, in the same
Postgres as the recipes. There is no second service to run, back up or keep
in step, an image goes with what it belongs to by the same foreign keys as
everything else, and only the app can reach it. The cost is a database, and
a `pg_dump`, that grow with photos; it is affordable because what is stored
is a small derivative, never the original.

The way out is kept open rather than built: every image is read from
`GET /api/images/{id}` and never from a storage URL, so moving the bytes to
an S3 bucket later changes what that route reads and nothing that links to
it. The signal to move is backups becoming painful, not a size.

- **Dish photos belong to a version**, not the line: each version is another
  go at the dish. Ten at most, in an order, one the cover. A new progression
  starts with none, and so does a variant. Deleting a version deletes its
  photos, and those of the progressions the deletion takes with it; the
  question before a delete counts them.
- **A card shows the pinned version's cover**, else the newest cover anywhere
  in the line, else the page's `image`, so making a new version does not
  blank the card until it is photographed.
- **The source photo belongs to the line**: kept on its root, which lives as
  long as the line does, and read by every version through `line_id`. A
  variant takes a copy. `source.objectKey` is retired rather than filled: a
  source is copied into every version through a validator that cannot trust
  a client's key, so it would have been lost on the first new version.
- **The browser makes the derivatives**: about 1600 px and 400 px on the long
  edge, JPEG, orientation applied, EXIF (location included) dropped by the
  canvas. The server decodes nothing; it checks the sizes and the magic
  bytes, and serves what it found rather than what was claimed. A HEIC file
  a browser cannot draw is refused with a reason rather than decoded with a
  library; Safari, which most HEIC comes from, draws it.

**Translation.** `source_lang` is recorded but there is nowhere to put a
translation. Either a `translations JSONB` keyed by language tag, or a
`recipe_translations` table.

### Decided: shopping lists (#84)

A list is made from one or more recipes, each at the servings chosen, and
belongs to its owner like a recipe does.

- **Merging is by food.** Lines with the same `food.key` (#132) are one line.
  Their `canonical` amounts, scaled by the same factor as the recipe, add up
  in grams or millilitres, and counts add to counts. What cannot be added
  (a count beside grams, or a weight beside a volume for a food with no
  `gramsPerMl`) stays a line of its own under the same food, amount as
  written; no conversion is guessed. A line with no key merges with
  nothing (#133 is how names get keys). A merged amount is shown in the
  reader's units, converted in the browser by one shared function from
  grams or millilitres into cups, spoons, ounces or pounds.
- **A list is stored, not recomputed.** Making it copies the merged items
  into a table, so a tick, an item added by hand or an edit stays put, and
  editing a recipe afterwards does not move a line under a tick. The list
  also records which recipes it came from, at which servings, so a recipe
  page can link to the lists it is on. Deleting that recipe drops the link
  and keeps the items. Three tables, one migration.
- **Nothing is left out.** Salt and oil go on the list like anything else and
  are ticked off. Knowing what is already in the kitchen is #96.
- **Lists are the owner's alone.** Sending one elsewhere is #95. Sharing
  between accounts waits for recipes to be shareable.

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

### Seeing a line

Two views, settled in #31. A recipe page shows only the straight path from the
root down to the version on it — how this one came to be — folded away unless
the version is an earlier one, and absent for a recipe with no history. The
whole tree is a page of its own, `/recipes/{id}/lineage`, drawn with Vue Flow:
forks, the versions after this one, and each variant by its entry point. Both
read the same `GET /api/recipes/{id}/history`, which sends card fields rather
than recipes, and both can pin and delete any version they show.

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

The count is a dry run of the route (`DELETE …?dryRun=true`), not a field on
`GET /api/recipes/{id}`. That way the preview and the deletion are the same
walk of the tree, and reading a recipe does not pay for a question that is
only asked when someone reaches for Delete (#49).

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
- **The SSRF guard is in code only.** Since #117 the fetcher resolves each
  connection's host once, refuses any non-public address or a port other than
  80 and 443, and connects to the address it checked, redirects included
  (`guard.py`). Its own Compose project still keeps the blast radius small as a
  second layer. A host firewall rule would be a third, against a bug in the
  guard or a library making requests of its own (#118).
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
  because a line cannot say whether it means US or metric. Display picks from
  `source_lang`: bare `en` and `en-US` are US measures, `en-AU` has the 20 ml
  tablespoon, everything else is metric (imperial for a fluid ounce). That
  decides how many millilitres a cup is when the reader switches the recipe to
  metric. `c` is disambiguated by magnitude: below 90 it is a cup, at or above
  it is Celsius; a written degree sign makes it a temperature outright.
- **Imperial or metric.** A toggle beside the title, "US | Met", converts
  cups, fluid ounces, ounces, pounds, °F and inches to their metric
  counterparts and back, rounded to what a kitchen measures in. Spoons are on neither side and stay as
  written. Converting into imperial means US measures. Each recipe opens in the
  system it was written in until the reader picks one; the pick is a cookie,
  so the server renders the same amounts, and it holds for every recipe after.
- **Editing is text in, structure out.** The editor (#34) edits what a person
  typed and sends it back as text; the server reads the amounts and re-links
  the steps, as it does for an extraction. A line left untouched goes back
  exactly as it came, parsed amount included. Steps keep their source numbers
  while they keep their order; once one is added, removed or moved, the
  numbers are dropped and the page counts them.
- **Three saves, one choice.** Unsaved changes offer the three as options
  with a line each saying what happens to the recipe on the page, then one
  button that does the chosen one. "New version" (progression) is chosen to
  start with, because it is the one that loses nothing; "Overwrite this
  version" is the one marked as losing something, before the click. A new
  version or a separate recipe (variant) is a new row, and the page moves to
  it. There is no sharing yet, so every recipe that can be opened is the
  reader's own and all three are always offered.
- **Deleting asks with a count.** The dry run is read first, so the question
  is "Delete this recipe?" or "…and 2 later versions?". Variants survive a
  delete and are not mentioned. Afterwards the page goes to whatever the line
  is entered by now, or to the collection if the line ended, and the listing
  is read again. A 404 is already-deleted, and treated as done.
- **Reading or editing.** #34 asked for no edit mode at all; it has one after
  all, because reading is where scaling (#44) happens, and a tapped amount
  cannot both set the scale and edit the recipe. A stored recipe opens to be
  read, with a "View | Edit" switch beside the title. Editing shows the
  amounts as stored, and unsaved changes hold the switch on Edit, since
  reading would show the recipe without them. A fresh import in the dialog
  has nothing to scale and is always editable.
- **Scaling is a way of reading.** One factor, set from the servings or from
  one ingredient's amount (the anchor, which then reads exactly as typed).
  It moves ingredients and the step amounts marked `scaleWithPortions: true`;
  oven temperatures, times and lengths stay put, and an amount nothing says
  how to scale is left as written and marked "not scaled", as is a line with
  no amount at all. Amounts round to what can be measured and move between
  g and kg, ml and l, oz and lb as they cross. The scale is a session cookie
  for the recipe it was set on: it survives a reload, and opening another
  recipe drops it.
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
  folded two steps into one and left a gap in the sequence. Settled (#55): the
  text keeps the number, since it is what the source said, and the page takes
  it out and shows it once. When the source numbered its steps, its numbers
  are the ones shown and a step it left unnumbered ("Marinade: …") stays
  unnumbered; when it numbered none, the page counts from one.
