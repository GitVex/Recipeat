# Recipeat Fetcher

A small FastAPI service that fetches recipes from the web and parses their
ingredients, using [recipe-scrapers][scrapers] and [ingredient-parser][parser].
Both are deterministic, so a website import runs no model at all.

It is internal: the Nuxt app is the only caller, and nothing here is
authenticated. Keep it off published ports.

[scrapers]: https://github.com/hhursev/recipe-scrapers
[parser]: https://github.com/strangetom/ingredient-parser

## Run

```sh
uv sync
uv run fastapi dev src/recipeat_fetcher/app.py   # reload, docs at /docs
uv run recipeat-fetcher                          # or serve with the settings below
```

`GET /health` answers `{"status": "ok"}` once it is up.

## Fetch

`POST /fetch` scrapes a recipe from a supported site and parses its ingredient
lines in the same call.

```sh
curl -X POST http://localhost:8000/fetch \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://www.seriouseats.com/..."}'
```

```jsonc
{
  "title": "…",
  "language": "en",
  "yields": "4 servings",     // as written; the portion count is read out of it in Nuxt
  "image": "https://…",
  "totalTime": 45,            // minutes
  "siteName": "Serious Eats",
  "author": "…",
  "canonicalUrl": "https://…",  // the page's own, else the URL asked for
  "ingredients": [ /* below */ ],
  "steps": ["…"]
}
```

| Status | Meaning |
|---|---|
| 413 | The page is larger than the read limit |
| 415 | The URL served something that is not a web page |
| 422 | `url` is missing or malformed, the site has no scraper, or the page holds no recipe |
| 502 | The site answered with an error, was unreachable, or redirected too many times |
| 504 | The site did not answer in time |

Every field but `canonicalUrl` and the two lists can be null: `to_json` on a
scraper returns whatever getters that site implements, and a getter may fail on
a page that omits the field. The models here narrow that to a fixed shape, which
is what keeps the response stable across a `recipe-scrapers` upgrade.

Only the first 200 ingredient lines are parsed.

The page is fetched in `page.py` rather than by `scrape_me`, which downloads
before it checks whether a scraper exists for the host, and does it with no
timeout, no read limit, and a strict UTF-8 decode that fails on any page served
in another encoding.

**There is no SSRF guard yet.** No address is resolved and checked, and a
redirect is followed wherever it points, so a URL given to this service can
reach anything the container can. Until that lands, it must not share a network
with anything private.

## Parse ingredients

`POST /ingredients` turns ingredient lines into structured amounts and names.
It takes the same lines `/fetch` reads, so the text pipeline can use it too.

```sh
curl -X POST http://localhost:8000/ingredients \
  -H 'Content-Type: application/json' \
  -d '{"ingredients":["1 1/2 cups milk","2-3 tbsp olive oil"]}'
```

Request: `{ "ingredients": string[] }`, at most 200 entries. Parsing is CRF
inference and holds a worker for the whole request, hence the cap.

```jsonc
[
  {
    "originalText": "1 1/2 cups milk",   // the line as given, never normalised
    "name": "milk",
    "quantity": "1 1/2 cups",            // the amount as written
    "parsedQuantity": { "value": 1.5, "maxValue": null, "unit": "cup" },
    "extra": null
  },
  {
    "originalText": "1 cup parsley, chopped, for garnish",
    "name": "parsley",
    "quantity": "1 cup",
    "parsedQuantity": { "value": 1, "maxValue": null, "unit": "cup" },
    "extra": "chopped, for garnish"
  }
]
```

`quantity` carries the same meaning as the key of that name in the draft the
model produces, so the Nuxt side reads both sources through one code path.
`parsedQuantity` is the addition: the same amount read into numbers, or null
when it could not be, in which case Nuxt parses the text itself.

`maxValue` is set only for a range. The parser reports an upper limit equal to
the value otherwise, and passing that on would stop a quantity ever comparing
equal to the same amount found in a step.

`extra` is what is left of the line once the amount and the name are out — the
parser's preparation, comment and purpose, joined in the order they appear.
They read as one phrase in a sentence (`chopped, for garnish`), and nothing
downstream needs to tell them apart, so they arrive as one field.

| Line | `extra` |
|---|---|
| `1 onion, finely diced` | `finely diced` |
| `2 tbsp butter, plus more for serving` | `plus more for serving` |
| `flour, for dusting` | `for dusting` |
| `200ml cream, chilled, for the topping` | `chilled, for the topping` |

Four shapes to expect, none of them rare:

| Line | Result |
|---|---|
| `2 (28 ounce) cans tomatoes` | Two amounts; the first is used and the line keeps the rest |
| `1 lb 2 oz potatoes` | Composite, combined into the unit the line led with — `1.125 lb` |
| `a pinch of saffron` | An amount with no number: `parsedQuantity` is null |
| `salt and pepper` | Two names; the first is used |

## The unit vocabulary

`units.json` maps pint's canonical unit names onto the `Unit` union in
`server/extraction/recipe.ts`. It is a data file because a test on the
TypeScript side reads it to prove the two agree — where they drift nothing
throws, a step's amount simply stops linking to the ingredient it restates.

Two rules keep the parsers comparable:

- Only units `parseQuantity` can also produce. `cup`, `tbsp`, `tsp` and `fl_oz`
  stay regionally ambiguous, resolved at display time, exactly as the text
  pipeline leaves them.
- An unrecognised unit is reported as no unit, never guessed at. A unit outside
  pint's registry — `cans`, `sticks` — drops the whole amount instead, so the
  text parser gets its turn at the same string.

## Configure

Environment variables, or a `.env` file next to `pyproject.toml`. All are
optional.

| | | |
|---|---|---|
| `FETCHER_HOST` | `127.0.0.1` | Interface to bind |
| `FETCHER_PORT` | `8000` | Port to bind |
| `FETCHER_RELOAD` | `false` | Reload on source changes |
| `FETCHER_FETCH_TIMEOUT` | `10.0` | Seconds to wait on a recipe site |
| `FETCHER_FETCH_MAX_BYTES` | `5000000` | Largest page to read |
| `FETCHER_FETCH_MAX_REDIRECTS` | `3` | Redirects to follow |

## Layout

| | |
|---|---|
| `app.py` | `create_app`, and the `app` that `fastapi dev` imports |
| `config.py` | `Settings`, read from the environment |
| `models.py` | The wire contract, camelCase for its one TypeScript consumer |
| `page.py` | Fetching a page: timeout, read limit, content type, encoding |
| `units.py`, `units.json` | The unit vocabulary shared with the Nuxt side |
| `routers/` | One module per group of endpoints, included in `create_app` |
