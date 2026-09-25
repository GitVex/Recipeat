# Recipeat

A little inspiration. A lot of good food.

Recipeat turns recipes from photos, websites, and scraps of text into your own
collection. It is a Nuxt 4 app with Zitadel login, a hosted model for reading
recipes and one small Python service behind an authenticated extraction API.

## Run

```sh
npm install
npm run dev
```

Needs Node.js 22.19+. Login and extraction both require a running server;
`nuxt generate` cannot serve them. Storage needs a database — see
[Database](docs/database.md) — and without `NUXT_DATABASE_URL` the server
starts and answers 503.

```sh
npm run build
node .output/server/index.mjs
```

## Test

```sh
npm run test:database                # node:test, no database needed
npm run test:recipes                 # node:test, the validator on the way in
NUXT_DATABASE_URL=... npm run test:database:live   # the migration runner, against a real Postgres
npm run test:extraction              # node:test, no browser or model needed
npm run build && npm run test:auth   # Playwright against a mock OIDC issuer
cd services/recipeat-fetcher && uv run pytest   # the fetcher service
```

## What works today

- **Landing page and recipe demo.** The collection lives in browser local
  storage, and the import dialog still shows labelled sample recipes.
- **Zitadel login** through `nuxt-oidc-auth`, with `GET /api/me` as the worked
  example of a server-enforced private endpoint.
- **`POST /api/extract/text`** sends text to the model and returns a normalized
  recipe. It is authenticated, and it stores nothing yet.
- **`POST /api/extract/website`** turns a recipe URL into the same shape through
  the fetcher service, with no model involved. Also authenticated, also stores
  nothing.
- **`POST /api/extract/photo`** sends an uploaded photo to the same model the
  text path uses, which reads the page itself. The image is read and discarded
  — nothing stores it yet.
- **`POST /api/recipes`** writes an extracted recipe to Postgres, owned by the
  subject in the session. `GET /api/recipes` lists a user's collection and
  `GET /api/recipes/{id}` reads one; nobody reaches another user's rows.
- **Save, progression, variant.** `PUT /api/recipes/{id}` corrects a version in
  place; `POST /api/recipes/{id}/progressions` adds a version to its line and
  moves the pin to it; `POST /api/recipes/{id}/variants` branches into a line
  of its own. [Planning](docs/planning.md) has what those words mean.

The browser does not call any of that yet: the demo collection is still
browser-local and the import dialog still shows samples.
[Planning](docs/planning.md) covers what is left.

## Docs

| | |
|---|---|
| [Authentication](docs/authentication.md) | Zitadel application, secrets, deployment |
| [Fetcher](services/recipeat-fetcher/README.md) | The Python service behind website import |
| [Database](docs/database.md) | Postgres, migrations, and the third container |
| [Extraction](docs/extraction.md) | The API, the pipeline, the recipe shape |
| [API map](docs/api-map.md) | Every route, arranged for testing by hand in Postman |
| [Planning](docs/planning.md) | What is next, and what is still undecided |
| [Architecture](docs/architecture.svg) | The two containers, their networks, and every request path |

Photography comes from Unsplash and fonts from Google Fonts, so both need
internet access.
