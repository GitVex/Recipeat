# Working on Recipeat

## Issues and milestones

Before filing an issue or moving one between milestones, read the Waves rules
in `docs/planning.md`: at most four top-level features and one migration per
Wave, `Plan:` issues in the Plans milestone, and bugs in the current Wave.
Never move a bug into Bug Hell; only the maintainer does that.

## Running the app to check a change

The app is checked in the `recipeat-app` container on `http://127.0.0.1:8100`,
not with `nuxt dev`. Port 8100 belongs to that container. Redeploy it from the
working tree after a change, then test against it:

```sh
url=$(grep '^NUXT_DATABASE_URL=' .env | cut -d= -f2- | sed 's#@127.0.0.1:#@recipeat-postgres:#')
NUXT_DATABASE_URL="$url" docker compose -f docker/compose.app.yaml --env-file .env up -d --build
```

Wait for `docker inspect recipeat-app --format '{{.State.Health.Status}}'` to say
`healthy`. Migrations run at startup, so `docker logs recipeat-app` is also
where a failed one shows up.

**The database URL must be overridden.** `.env` points `NUXT_DATABASE_URL` at
`127.0.0.1`, which is right for tests run from the host and wrong inside the
container, where Postgres is the `recipeat-postgres` alias on
`recipeat-db-net`. Without the override the container starts, cannot reach the
database, and answers 503 on every storage route.

Postgres (`recipeat-postgres`) and the fetcher (`recipeat-fetcher`) are
separate Compose projects and stay up; only the app needs redeploying.

## Tests

From the host, with `.env` supplying the loopback database URL:

```sh
npm run test:recipes      # unit tests, no database
npm run test:database     # the migration runner's file handling
node --env-file=.env --experimental-strip-types --test tests/database.live.ts
```

The live tests work in schemas of their own and drop them afterwards, so the
development database is untouched.

The browser tests run against the container, with the API mocked per test:

```sh
npx playwright test
```

**If every browser test times out on `page.goto('/')`,** something other than
the container is holding port 8100 on IPv6. The container publishes on
`127.0.0.1` only, and `localhost` resolves to `::1` first, so a leftover
`nuxt dev` listening on `[::1]:8100` catches every request. Find it with
`Get-NetTCPConnection -LocalPort 8100` and ask before stopping it; don't
start a `nuxt dev` alongside the container.
