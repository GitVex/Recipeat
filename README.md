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
`nuxt generate` cannot serve them.

```sh
npm run build
node .output/server/index.mjs
```

## Test

```sh
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

The demo collection is not connected to an account, and no recipe is written to
a database. [Planning](docs/planning.md) covers what that needs.

## Docs

| | |
|---|---|
| [Authentication](docs/authentication.md) | Zitadel application, secrets, deployment |
| [Fetcher](services/recipeat-fetcher/README.md) | The Python service behind website import |
| [Extraction](docs/extraction.md) | The API, the pipeline, the recipe shape |
| [API map](docs/api-map.md) | Every route, arranged for testing by hand in Postman |
| [Planning](docs/planning.md) | What is next, and what is still undecided |
| [Architecture](docs/architecture.svg) | The two containers, their networks, and every request path |

Photography comes from Unsplash and fonts from Google Fonts, so both need
internet access.
