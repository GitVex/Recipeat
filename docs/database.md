# Database

Postgres, reached by the app over its own network, with migrations applied at
app startup. Nothing else talks to it.

## Shape

| | |
|---|---|
| `docker/compose.db.yaml` | The Postgres service, its volume and its network |
| `server/database/migrations/` | Plain `.sql`, applied in filename order |
| `001_recipes.sql` | The `recipes` table, its lineage columns and its triggers |
| `002_collections.sql` | `collections`, and `collection_recipes`: which lines are in each, in what order |
| `003_tags.sql` | `tags`, and `recipe_tags`: which lines wear each |
| `004_preferences.sql` | `preferences`: one settings document per person |
| `005_images.sql` | `images`: dish photos per version, and a line's source photo, as bytes |
| `006_ingredients.sql` | The ingredient table, what it learns from, and FoodData Central |
| `server/database/migrate.ts` | The runner: a ledger, an advisory lock, one transaction per file |
| `server/plugins/database.ts` | Runs the above at startup and holds requests until it is done |
| `server/utils/database.ts` | The shared connection pool |
| `server/recipes/` | What the routes do with it: validate, write, list, read |
| `server/database/schema.ts` | The table as Kysely sees it, and the casts a statement needs |

Two ways of asking, on one pool. The three POST routes build their statements
with **Kysely**; the PUT and the two GETs are still postgres.js tagged
templates. The dialect wraps the existing postgres.js instance rather than
opening a pool of its own, so this is a migration in progress rather than two
databases — `useDatabase()` and `useKysely()` are the same connections, and
closing either closes both.

Writing a `jsonb` column takes the `json()` helper from `schema.ts`, which
casts the value rather than stringifying it. Handing `JSON.stringify(value)` to
a parameter the cast has typed as `jsonb` makes postgres.js encode the string
it was given, and the column ends up holding `"[{...}]"` instead of an array.
The `jsonb_typeof` checks in the migration catch it; the tests catch it
sooner.

It is a separate Compose project, and in Coolify a separate resource, because
the app redeploys on every push and a redeploy recreates that project's
containers — a database in there would restart each time, and its volume would
live in a namespace Coolify tears down with the resource.

It is not on `recipeat-fetch-net`. That network exists to contain the fetcher,
which opens connections to URLs a user supplies. It refuses private addresses
in code (#117), and the network keeps a database out of reach even if that
check ever fails.

## Collections

A collection holds versions, not lines: the version that went in is the one it
shows, whatever the line's pin does afterwards. Two versions of one line can
sit in the same collection. The membership's foreign key is
`(recipe_id, owner_sub)`, so only the collection owner's recipe can go in, and
a deleted version drops out of every collection. So do the progressions that
deleting it takes along.

Deleting a collection deletes its memberships and never a recipe.

Names are unique per owner regardless of case, one line, trimmed, and at most
80 characters. `position` ascends within a collection but may have gaps. Two
rows can't share one, and that check is deferred to commit, so a reorder can
rewrite the positions in any order inside one transaction.

## Tags

A tag hangs on a line, not a version. `recipe_tags.line_id` references the
line's root, which exists as long as the line does, since deleting the root
takes the whole line. Saving a progression or moving the pin keeps a recipe's
tags. A variant is a line of its own and starts with a copy of its parent
line's tags.

Tags are per owner, and so are both foreign keys, so a line cannot wear
someone else's tag. Names are unique per owner regardless of case. The first
spelling typed is the one kept. A name is one line, trimmed, with no runs of
whitespace, and at most 40 characters.

A tag that no line wears any more keeps its row. Deleting it would race a
write that has just found it to reuse. `GET /api/tags` lists only tags in use,
so a leftover row costs nothing, and typing the name again reuses it.

## Preferences

One row per person, keyed by `owner_sub`, made on their first save. No row
reads as nothing set. The preferences themselves are one `jsonb` document,
`settings`, and the table only checks that it is an object. Which preferences
exist, and what each may hold, is `PREFERENCES` in
`shared/utils/preferences.ts`. The route checks every save against it.

Adding a preference is an entry there, with no migration. The `Preferences`
type, the route's check and the profile's form all follow from it. Read it
anywhere in the app with `usePreferences()`, which is null when nobody is
signed in. A form for a new `kind` of preference is a branch in
`app/pages/profile.vue`.

Reading follows the config as it is now. A key it no longer has is left out,
and a stored value it would not take reads as unset. The next save drops both.
Renaming a key loses what was saved under the old name, unless something copies
it over.

Signed out, the `recipeat-units` cookie still holds the unit system. Signed
in, the account's settings win and the cookie is ignored.

## Images

Bytes in the table rather than an object store; why is in
[planning.md](planning.md#decided-images-live-in-postgres-45). Each row is
one picture in two sizes, `data` (about 1600 px) and `thumb` (about 400 px),
both made by the browser. `media_type` is what the bytes were found to be on
upload. Both columns are `STORAGE EXTERNAL`: JPEG does not compress, so TOAST
is told not to try.

`recipe_id` is a version for a dish photo and the line's root for the source
photo, matched on `owner_sub` like every other reference. Positions run 0 to 9
without gaps and are unique per version, deferred to commit as collection
positions are, so the limit of ten is the schema's. One cover per version and
one source photo per line are partial unique indexes.

Nothing but `readImage` selects `data` or `thumb`. Every other query names its
columns, and has to keep doing so: a `selectAll()` on `images` would carry
megabytes per row through the pool. The card's cover is a subquery that
returns an id, and the URL is built from it.

An image's bytes never change: replacing the source photo deletes the row and
writes a new one. That is what lets `/api/images/{id}` be cached as immutable.

## Ingredients

The ingredient table (#147), which was a file until then. `ingredients` holds
one key per food, with its form and its density from FoodData Central.
`ingredient_names` holds the names a key is matched by, per language, in the
order they are shown. The migration seeded both once with the 420 entries of
#132. A wrong seeded name or density is fixed by a later migration.

Normalization never queries these tables. It matches against a snapshot of
them held in memory. How the snapshot is loaded and refreshed, and how the
table learns, is in [extraction.md](extraction.md#the-ingredient-table).

`ingredient_sightings` records each name a saved recipe used that matched
nothing, with the cook and the recipe. It only grows: an edit or a deletion
leaves the sighting, and a deleted recipe leaves it with no `recipe_id`.
`ingredient_alias_votes` holds the answers of #133, and `ingredient_flags`
holds pairs of keys that may be one food, for a curator (#148). The views
`ingredient_sighting_counts` and `ingredient_alias_counts` count cooks with
the opt-out applied, as `ingredient_opted_out` reads it from `preferences`.
The thresholds are the app's configuration, so a view returns counts and the
query compares them.

`fdc_foods` and `fdc_portions` are SR Legacy and Foundation Foods, loaded and
replaced whole by `scripts/ingredients.ts`. They are plain tables beside the
others rather than a schema of their own, so the live tests isolate them like
everything else. `pg_trgm` searches them and `fuzzystrmatch` compares names.
Both extensions live in `public`.

`recipes_touch_updated_at` leaves `updated_at` alone in a transaction that
sets `recipeat.renormalizing`. Only re-normalization sets it, since giving a
recipe a key it was missing is not an edit.

## A fresh database

```sh
docker network create recipeat-db-net
POSTGRES_PASSWORD=... docker compose -f docker/compose.db.yaml up -d
```

The first start creates the cluster, the `recipeat` database and its user.
`--data-checksums` is set at that moment and cannot be added later without a
rewrite, so a cluster created by other means is worth recreating.

Nothing else is needed: the app applies the schema itself the next time it
starts.

## Development

Postgres publishes on `127.0.0.1:5432`, so a checkout points straight at it:

```sh
NUXT_DATABASE_URL=postgres://recipeat:PASSWORD@127.0.0.1:5432/recipeat npm run dev
```

Without that variable the server still starts and serves the landing page and
login — it logs that storage is unavailable, skips migrations, and answers 503
on the routes that need a database. A deployment cannot end up there:
`compose.app.yaml` marks the variable required.

Reaching it by hand, for a dump or a look around:

```sh
docker exec -it recipeat-postgres psql -U recipeat -d recipeat
```

## Migrations

Named `NNN_name.sql`, three digits at least, zero-padded so filename order and
apply order are the same thing. `server/database/migrations/README.md` has the
rules; the short version is that the runner refuses a name it does not
recognise rather than skipping the file, and refuses two files sharing a
number.

They run when the app starts. What has been applied is recorded in
`schema_migrations`, so a restart with nothing new to do writes nothing, and
each file is applied inside a transaction together with its own ledger row — a
failure leaves neither half.

Two app containers starting at once take a `pg_advisory_lock` in turn: the
second waits, then finds nothing left to do.

**A failed migration stops the app from serving.** In production the process
exits and the orchestrator restarts it; in development it stays up and every
request answers 503 with the reason in the log. A half-migrated schema
answering requests is the one outcome worth avoiding — a restart loop is
visible, a schema a column short is not.

A file that has been applied anywhere is never edited. The ledger keys on the
filename, so a changed file is a file that has already run.

## Testing the runner

`npm run test:database` covers the half that needs no database: which files are
applied, in what order, and which names are refused. `npm run test:recipes`
covers the validator a posted recipe goes through, which needs one even less.

The rest wants a real Postgres, and skips without one:

```sh
NUXT_DATABASE_URL=postgres://recipeat:PASSWORD@127.0.0.1:5432/recipeat npm run test:database:live
```

It works inside a schema of its own and drops it afterwards, so a development
database keeps its own tables and its own ledger. What it covers is what is
hard to reason about from the code: that a multi-statement file runs to the
end, that a re-run writes nothing, that a failing file leaves neither the
schema change nor the ledger row, that two runners at once produce one applied
migration rather than two, what the schema itself refuses, and what the store
writes and reads back.

`npm run test:auth` takes `NUXT_DATABASE_URL` too, and uses it for one test:
signing in, saving a recipe and checking the row is attributed to the session's
subject. Without the variable that test skips and the rest of the suite runs as
before.

## Deploying to Coolify

Three resources now: the fetcher, the database, the app. Each is a Docker
Compose resource with **Base Directory** `/docker` and its own **Docker Compose
Location**, because Coolify passes `--project-directory` and the build contexts
in these files are relative.

1. Create the networks on the host, once:
   `docker network create recipeat-fetch-net && docker network create recipeat-db-net`
2. Deploy `compose.db.yaml` with `POSTGRES_PASSWORD` set. Turn **Connect To
   Predefined Network** off — it would put the database on Coolify's shared
   `coolify` network, where everything else Coolify runs could reach it.
3. Deploy `compose.app.yaml` with `NUXT_DATABASE_URL` pointing at the alias,
   not the container name, which Coolify renames:
   `postgres://recipeat:PASSWORD@recipeat-postgres:5432/recipeat`

The app cannot `depends_on` a service in another project, so it will sometimes
start before Postgres is accepting connections. It retries for about half a
minute before giving up, which also covers a database restart under a running
app.

## Backups

Not automated. `pg_dump` against the published loopback port is the manual
version:

```sh
docker exec recipeat-postgres pg_dump -U recipeat recipeat | gzip > recipeat-$(date +%F).sql.gz
```

Coolify's scheduled backups only cover databases created as Coolify database
resources, which this is not — that was the trade for keeping the
configuration in the repo rather than in a web UI.

Photos are in the dump since #45, and will soon be most of it: at roughly
400 KB a photo, a thousand versions with ten each is about 4 GB. They do not
compress further, so the `gzip` above saves nothing on them.
