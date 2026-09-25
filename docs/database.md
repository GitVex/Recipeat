# Database

Postgres, reached by the app over its own network, with migrations applied at
app startup. Nothing else talks to it.

## Shape

| | |
|---|---|
| `docker/compose.db.yaml` | The Postgres service, its volume and its network |
| `server/database/migrations/` | Plain `.sql`, applied in filename order |
| `001_recipes.sql` | The `recipes` table, its lineage columns and its triggers |
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
which opens connections to URLs a user supplies and has no SSRF guard; a
database is exactly what it must not be able to reach.

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
