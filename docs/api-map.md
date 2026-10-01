# API map

Every route the deployment answers on, arranged for testing by hand. The shapes
and the reasoning behind them live in [extraction.md](./extraction.md); this is
the operational view — what to point Postman at, and what stands in the way.

There are two tiers. The **app** is public and needs a session on four of its
five routes. The **fetcher** is unauthenticated and published on loopback only,
so reaching it at all takes a tunnel. Extraction itself runs at Google and is
not reachable from here. Extraction stores nothing and is safe to repeat;
`POST /api/recipes` is the one call here that writes a row, and repeating it
writes another.

## Variables

Set these as a Postman environment. The service ports are the host-side ones
from [`docker/`](../docker); see [architecture.svg](./architecture.svg).

| Variable | Value | Notes |
|---|---|---|
| `app` | `https://your-coolify-domain` | Whatever FQDN the Coolify resource serves |
| `fetcher` | `http://127.0.0.1:8103` | Through the tunnel below |

### Reaching the fetcher

It publishes to `127.0.0.1` on the VPS, so nothing off that host can reach it —
that is deliberate, and it applies to your laptop too:

```sh
ssh -N -L 8103:127.0.0.1:8103 root@YOUR_VPS_IP
```

While it runs, `127.0.0.1:8103` on your machine is the VPS's. Leave it open for
the whole session; Postman needs no proxy configuration.

The fetcher is FastAPI, so it serves interactive docs at `{{fetcher}}/docs` —
worth opening in a browser alongside Postman, since they are generated from the
same models the service validates against.

8101 and 8102 were Ollama and the OCR service, and answer nothing now.

## Getting a session

The four guarded app routes read an encrypted cookie named `nuxt-oidc-auth`.
Only the OIDC round trip mints one, and it needs a browser: Authorization Code
with PKCE, a redirect out to Zitadel, and a redirect back. Postman cannot drive
that.

So borrow one:

1. Open `{{app}}` in a browser and sign in.
2. DevTools → Application → Cookies → `{{app}}` → copy the value of
   `nuxt-oidc-auth`.
3. In Postman, either add it to the cookie jar for that domain (Cookies, under
   the send button) or set a header on each request:
   `Cookie: nuxt-oidc-auth=<value>`.

The cookie is `HttpOnly`, so `document.cookie` will not show it — DevTools is
the way. It is also `Secure` in production, meaning it will not travel over
plain HTTP; point Postman at the HTTPS origin.

`GET {{app}}/api/me` is the check. A 200 means the cookie took; a 401 means it
did not, and every extraction route will answer 401 too.

### Two Postman settings that will bite

- **Raise the request timeout.** Settings → General → Request timeout. The
  default of 0 (no timeout) is fine, but any non-zero value under five minutes
  will cut off `/api/extract/text` and `/api/extract/photo` mid-inference. The
  first call after a container restart is the slowest, while the model loads.
- **Send the right content type.** The two JSON routes answer **415** on
  anything but `application/json`. Postman sets that automatically for a `raw`
  body of type JSON, and *not* for `raw` → Text.

---

## App — `{{app}}`

### `GET /api/me`

Session probe. No body.

```
GET {{app}}/api/me
Cookie: nuxt-oidc-auth=<value>
```

200 → `{ "provider": "zitadel", "subject": "<sub>", "profile": { … } }`, sent
with `Cache-Control: no-store`. 401 → no session.

### `POST /api/extract/text`

```
POST {{app}}/api/extract/text
Content-Type: application/json
Cookie: nuxt-oidc-auth=<value>

{ "text": "2 eggs, beaten.\nFry them in butter." }
```

Body `{ "text": string }`, at most 20 000 characters. Answers
`{ "recipe": { … } }`.

| Status | Meaning |
|---|---|
| 401 | No session |
| 415 | Content type is not JSON |
| 400 | Not valid JSON, or `text` missing, not a string, or blank |
| 413 | Over 20 000 characters |
| 422 | The model found no recipe in the text |
| 502 | The model was unreachable, failed, or answered with something unusable |
| 503 | Busy or over quota; retry rather than investigate |
| 504 | The model did not answer within a minute |

Expect a few seconds. Start here anyway: it exercises the model path with the
least that can go wrong.

### `POST /api/extract/website`

```
POST {{app}}/api/extract/website
Content-Type: application/json
Cookie: nuxt-oidc-auth=<value>

{ "url": "https://www.seriouseats.com/..." }
```

Body `{ "url": string }`, http or https, at most 2048 characters. Same
`{ "recipe": { … } }` shape.

| Status | Meaning |
|---|---|
| 401 | No session |
| 415 | Content type is not JSON |
| 400 | Not valid JSON, or `url` missing, not a string, or not an http(s) address |
| 413 | URL too long, or the page too large to read, or a post's images too large together |
| 422 | No recipe on the page (no scraper for the site and no schema.org markup), or the URL serves something that is not a page. For a post: missing or private (logged out they look the same), or no recipe found in it |
| 502 | The site, Instagram, the fetcher or the model failed or was unreachable |
| 503 | Instagram is throttling the fetcher, or the model is busy; retry later |
| 504 | The site, Instagram or the model did not answer in time |

**Seconds, not minutes** — no model runs on this path. It is the fastest way to
confirm the app is wired to a service at all.

**A link to an Instagram post** (`/p/`, `/reel/` or `/tv/` on `instagram.com`,
query string allowed) is read differently (#120). The fetcher's `POST /instagram`
reads the post, given only its shortcode. Then up to three web links in the
caption are tried as above, and the first with a recipe wins. Failing that, the
model reads the caption and every image in one call. Either way the source is a
website source with a `post: { url, author }` crediting it. Expect several
seconds, and longer when the caption links to pages without a recipe.

Note the one deliberate remapping: the fetcher's own 415 (a URL serving a PDF)
arrives here as **422**, because that is a problem with what was asked for, not
with the content type of the asking.

### `GET /api/extract/sites`

```
GET {{app}}/api/extract/sites
```

`{ "hosts": string[] }`: the fetcher's `GET /sites`, passed on. No session,
since it is the public library's list. Cached in the server for a day and in
the browser for an hour, so after a fetcher upgrade the new list can take a day
to show; restarting the app clears it. 502 when the fetcher could not be asked,
which the import dialog takes as "no hint" rather than as an error.

### `POST /api/extract/photo`

```
POST {{app}}/api/extract/photo
Cookie: nuxt-oidc-auth=<value>
Body → form-data
  file : <select a file>     ← set the row's type to File, not Text
```

`multipart/form-data` with a `file` part, at most 10 000 000 bytes. Same
`{ "recipe": { … } }` shape.

| Status | Meaning |
|---|---|
| 401 | No session |
| 415 | Not multipart |
| 400 | Malformed multipart, or the `file` part is missing or empty |
| 413 | Over the byte limit |
| 422 | The model found no recipe in the photograph |
| 502 | The model was unreachable, failed, or answered with something unusable |
| 503 | Busy or over quota; retry rather than investigate |
| 504 | The model did not answer within a minute |

Do **not** set `Content-Type` by hand — Postman writes the multipart boundary
into it, and overriding the header drops the boundary and earns a 400.

Expect five to nine seconds for a page. Nothing on this side decodes the image,
so the media type the browser declared is forwarded as-is and an unreadable one
is answered for by the model, not caught here.

### `POST /api/recipes`

```
POST {{app}}/api/recipes
Content-Type: application/json
Cookie: nuxt-oidc-auth=<value>

{ "recipe": { … whatever an extract route returned … } }
```

Body `{ "recipe": { … } }`, or the recipe itself unwrapped. Answers **201** and
`{ "recipe": { … } }` — the same shape it was given, plus `id`, `lineId`,
`pinned`, `createdAt` and `updatedAt`.

Post back exactly what an extraction returned, optionally edited. Ingredient
ids, step parts and the links between them are rebuilt here rather than
trusted, so editing the text of a step is enough to re-link the amounts inside
it. `owner_sub` comes from the session and is never read from the body.

| Status | Meaning |
|---|---|
| 401 | No session, or a session whose token carries no subject |
| 415 | Content type is not JSON |
| 400 | A field is the wrong type, an amount is not positive, a URL is not http(s), or the source is not one of text/website/photo |
| 413 | Over a limit: 300-character title, 200 ingredients, 100 steps, 5 000 characters a step |
| 422 | No ingredients and no steps — well-formed, but not a recipe |
| 503 | This deployment has no database configured |

### `PUT /api/recipes/{id}`

```
PUT {{app}}/api/recipes/6f1e9b3c-…
Content-Type: application/json
Cookie: nuxt-oidc-auth=<value>

{ "recipe": { … } }
```

**Save.** Replaces the version it names and creates nothing — the only one of
the three that overwrites, which is why it is the only one that is not a POST.
Works on any version you own, pinned or not, and moves neither the pin nor the
version's place in its line. Answers `{ "recipe": { … } }`.

Two saves racing is last write wins; `updatedAt` says which won.

### `POST /api/recipes/{id}/progressions`

```
POST {{app}}/api/recipes/6f1e9b3c-…/progressions
Content-Type: application/json
Cookie: nuxt-oidc-auth=<value>

{ "recipe": { … } }
```

**Save as Progression.** A new version in the same line, descended from the id
in the path — any version you own, pinned or not. Answers **201**. The new
version takes the pin, wherever in the tree it was made, so the collection
shows it from then on.

`lineId` is inherited and never taken from the body, which is what keeps a
progression of a progression in the line it came from.

### `POST /api/recipes/{id}/variants`

```
POST {{app}}/api/recipes/6f1e9b3c-…/variants
Content-Type: application/json
Cookie: nuxt-oidc-auth=<value>

{ "recipe": { … } }
```

**Save as Variant.** A branch that leaves the line: the new recipe points at
the id in the path and becomes the first version of a line of its own, with
its own pin. Answers **201**. The line it left keeps its own pin, and the
variant appears in a listing as its own entry.

All three take the same body as `POST /api/recipes` and answer the same 400,
413, 415 and 422 as it does, plus:

| Status | Meaning |
|---|---|
| 400 | The id in the path is not a UUID |
| 404 | No such version, or not yours — the same answer either way |
| 409 | Two progressions in one line at once; one of them got the pin, retry |

### `DELETE /api/recipes/{id}`

```
DELETE {{app}}/api/recipes/6f1e9b3c-…?dryRun=true
Cookie: nuxt-oidc-auth=<value>
```

**Delete.** Removes the version in the path and every progression descended
from it. Variants that branched off any of them survive as recipes of their
own, with `variantOf` cleared. No body.

If the pin was among what went, it moves to the deleted version's parent in
the same transaction, so a line that survives still has exactly one pinned
version. Deleting a root takes its whole line.

`?dryRun=true` answers the same question without deleting anything. That is
how the UI says "this will also delete 3 later versions" before it does. The
preview and the deletion walk the tree the same way, so the number they give
can differ only if the line changed in between. Any other query parameter is
refused rather than ignored, because a misspelled dry run must not delete.

Both answer 200 and
`{ "deletion": { "count": 3, "ids": [ … ], "pinned": "<id>" | null } }`:
how many versions went (or would go), which ones, and the version the line is
entered by afterwards — `null` when the line ended.

| Status | Meaning |
|---|---|
| 400 | The id is not a UUID, or a query parameter other than `dryRun=true` |
| 404 | No such version, or not yours — the same answer as `GET` |
| 409 | The line changed mid-deletion; nothing was deleted, retry |

### `GET /api/recipes/{id}/history`

```
GET {{app}}/api/recipes/6f1e9b3c-…/history
Cookie: nuxt-oidc-auth=<value>
```

The line the version in the path belongs to, from any version in it. Answers
`{ "history": { "lineId", "versions": [ … ], "variants": [ … ], "origin" } }`:

- `versions` — every version in the line, oldest first, each with `id`,
  `title`, `progressionOf`, `pinned`, `ingredientCount`, `stepCount` and the
  timestamps. Card fields, not recipes: `progressionOf` is enough to draw the
  tree, and reading one is `GET /api/recipes/{id}`.
- `variants` — each separate recipe that branched off a version in the line,
  by its entry point: `id` and `title` are its pinned version's, `variantOf`
  the version here it came from. Nothing of its own line is included.
- `origin` — `{ id, title }` of the version this line branched off, or `null`
  for a line that never did or whose origin has since been deleted.

| Status | Meaning |
|---|---|
| 400 | The id is not a UUID |
| 404 | No such version, or not yours |

### `PUT /api/recipes/{id}/pin`

```
PUT {{app}}/api/recipes/6f1e9b3c-…/pin
Cookie: nuxt-oidc-auth=<value>
```

**Pin.** Makes the version in the path the one its line is entered by — what
`GET /api/recipes` lists — and unpins the one that was. No body. Pinning the
version already pinned changes nothing, so it is a PUT. Answers
`{ "pinned": "<id>", "lineId": "<id>" }`.

| Status | Meaning |
|---|---|
| 400 | The id is not a UUID |
| 404 | No such version, or not yours |
| 409 | A progression was saved into the line at the same moment; retry |

### `GET /api/recipes`

```
GET {{app}}/api/recipes
Cookie: nuxt-oidc-auth=<value>
```

Answers `{ "recipes": [ … ] }`, newest first, at most 200. One entry per line:
the pinned version, with `id`, `lineId`, `title`, `image`, `totalTime`,
`portions`, `tags`, `ingredientCount`, `stepCount` and the timestamps — what a
card needs, not the whole recipe. Earlier versions of a line are not here; they are reachable by
id.

Filters narrow the list (#14). Each one narrows what the others left, and a
key given twice means both. The collection page's address uses the same query
string, so a filtered view can be linked:

```
GET {{app}}/api/recipes?q=soup&tag=Winter&tag=soup&ingredient=leek&maxTime=60&minPortions=2&maxPortions=4&source=website
```

| Parameter | Keeps a recipe when |
|---|---|
| `q` | Its title contains this, in any case |
| `tag` | Its line has every tag given, in any case |
| `ingredient` | An ingredient's name contains this, for every one given |
| `maxTime` | It states a total time, and it is this many minutes or fewer |
| `minPortions`, `maxPortions` | It states portions, and they are in range |
| `source` | It came from any of these: `website`, `photo`, `text`. A recipe from an Instagram post is `website` |

Terms are trimmed. A term given twice in different cases counts once. A
filter the server cannot read is a **400**, rather than being dropped. That
covers a number that is not a whole number from 1 up, an unknown source, a
term over 100 characters, a search over 200, and more than 10 terms of one
kind. Filtering happens in the query, on the owner's pinned rows, read newest
first through `recipes_owner_pinned_idx`.

### `GET /api/recipes/{id}`

```
GET {{app}}/api/recipes/6f1e9b3c-…
Cookie: nuxt-oidc-auth=<value>
```

Answers `{ "recipe": { … } }`, whole. Another user's recipe answers **404**
rather than 403: whether an id exists is not theirs to learn.

`tags` is the line's, A to Z: every version of a recipe wears the same set.
It is read-only here. A recipe sent to a save route may carry it, and it is
ignored; tags are set with `PUT /api/recipes/{id}/tags`.

| Status | Meaning |
|---|---|
| 400 | The id is not a UUID |
| 404 | No such recipe, or not yours |

### `GET /api/collections`

```
GET {{app}}/api/collections
Cookie: nuxt-oidc-auth=<value>
```

Answers `{ "collections": [ … ] }`, newest first. Each has `id`, `name`,
`count`, the timestamps, and `thumbnails`: up to four `{ id, title, image }`
from the start of the collection's order. A thumbnail is the version that was
added, not whatever its line has pinned since. `image` can be null, and a
collection with fewer than four recipes has fewer thumbnails.

### `POST /api/collections`

```
POST {{app}}/api/collections
Content-Type: application/json
Cookie: nuxt-oidc-auth=<value>

{ "name": "Weeknight" }
```

Answers **201** and `{ "collection": { "id", "name", "createdAt", "updatedAt" } }`.
The name is trimmed first.

### `PATCH /api/collections/{id}`

Same body. Renames the collection and answers `{ "collection": { … } }`. A
rename can change only the case of a name.

### `DELETE /api/collections/{id}`

No body. Answers **204**. The recipes in the collection stay; only the
grouping goes.

| Status | Meaning |
|---|---|
| 400 | The id is not a UUID; the name is missing, blank or more than one line |
| 404 | No such collection, or not yours — the same answer either way |
| 409 | You already have a collection with that name, in any case |
| 413 | The name is over 80 characters |
| 415 | Content type is not JSON (POST and PATCH) |

### `GET /api/collections/{id}`

```
GET {{app}}/api/collections/6f1e9b3c-…
Cookie: nuxt-oidc-auth=<value>
```

Answers `{ "collection": { "id", "name", "createdAt", "updatedAt", "recipes": [ … ] } }`.
`recipes` is in the collection's order, and each entry is the same card
`GET /api/recipes` returns, plus two fields:

- `pinned`: whether this version is still its line's pinned version
- `pinnedId`: the version that is. It equals `id` when `pinned` is true.

A collection holds the version that was added, so an entry can be an earlier
version. The UI marks it as one and links to `pinnedId`.

### `PUT /api/collections/{id}/recipes/{recipeId}`

No body. Adds the version to the end of the collection and answers **204**.
Adding one that is already there also answers 204, and moves nothing.

### `DELETE /api/collections/{id}/recipes/{recipeId}`

No body. Takes the version out of the collection and answers **204**. The
recipe itself stays. Removing one that is not there also answers 204.

### `PUT /api/collections/{id}/order`

```
PUT {{app}}/api/collections/6f1e9b3c-…/order
Content-Type: application/json
Cookie: nuxt-oidc-auth=<value>

{ "recipeIds": ["…", "…"] }
```

Sets the whole order, first to last, and answers with the collection as `GET`
does. The list must be exactly the collection's current members. A list
missing one, with an extra, or naming one that is not in the collection is a
**409** and changes nothing: read the collection again and retry.

| Status | Meaning |
|---|---|
| 400 | An id is not a UUID; `recipeIds` is not an array or names a recipe twice |
| 404 | No such collection, or no such recipe (for `PUT …/recipes/{recipeId}`), or not yours |
| 409 | The order is not exactly the current members |
| 413 | More than 1 000 ids in `recipeIds` |
| 415 | Content type is not JSON (the order) |

### `GET /api/tags`

```
GET {{app}}/api/tags
Cookie: nuxt-oidc-auth=<value>
```

Answers `{ "tags": [ { "name", "count" }, … ] }`: every tag at least one of
your recipes wears, A to Z whatever the case, with how many recipes wear it.
A tag no recipe wears any more is not listed.

### `PUT /api/recipes/{id}/tags`

```
PUT {{app}}/api/recipes/6f1e9b3c-…/tags
Content-Type: application/json
Cookie: nuxt-oidc-auth=<value>

{ "tags": ["weeknight", "Vegan"] }
```

Replaces the whole set of tags on the line this version belongs to, and
answers `{ "tags": [ … ] }` as stored, A to Z. Each name is trimmed and its
inner whitespace made one space. Names are case-folded: one you already have
in another case is that tag, and keeps the case it was first typed in. Two
names that differ only in case are kept once. `[]` takes every tag off.

A new variant starts with a copy of its parent line's tags. From then on they
are its own.

| Status | Meaning |
|---|---|
| 400 | The id is not a UUID; `tags` is not an array of strings; a name is blank or has a control character |
| 404 | No such recipe, or not yours |
| 413 | A name over 40 characters, or more than 20 tags |
| 415 | Content type is not JSON |

### `GET /api/preferences`

```
GET {{app}}/api/preferences
Cookie: nuxt-oidc-auth=<value>
```

Answers `{ "preferences": { "unitSystem", "portions" } }`. Either is null for
"as the recipe is written", and both are until something is saved.

### `PUT /api/preferences`

```
PUT {{app}}/api/preferences
Content-Type: application/json
Cookie: nuxt-oidc-auth=<value>

{ "unitSystem": "imperial", "portions": 4 }
```

Replaces the whole set and answers it as stored. Every preference is required
and nothing else is accepted. `unitSystem` is `"metric"`, `"imperial"` or null.
`portions` is a whole number from 1 to 100, or null. The owner comes from the
session. The full list is `PREFERENCES` in `shared/utils/preferences.ts`.

| Status | Meaning |
|---|---|
| 400 | A preference is missing, holds something it may not, or does not exist |
| 415 | Content type is not JSON |

### `GET /api/recipes/{id}/collections`

Answers `{ "collections": ["…", …] }`: the ids of every collection this
version is in, for the ticks in the picker. **404** if the recipe does not
exist or is not yours.

### Auth routes

Browser flows, listed so they are not mistaken for API endpoints. Following
them in Postman gets you a Zitadel login page, not a session.

| Route | What it is |
|---|---|
| `GET /auth/zitadel/login` | Starts the redirect to Zitadel |
| `GET /auth/zitadel/callback` | Where Zitadel returns; mints the cookie |
| `GET /auth/zitadel/logout` | Ends the session, both sides |
| `GET /api/_auth/session` | The module's own session read |
| `POST /api/_auth/refresh` | Refreshes against the stored refresh token |

`/api/me` is the better probe of the two session reads: it is this app's code,
and its 401 is the same 401 the extraction routes produce.

---

## Fetcher — `{{fetcher}}`

No auth. Called by `/api/extract/website`; testing it directly is how you tell
a fetcher problem from an app problem.

### `GET /health`

`{"status": "ok"}` once it is up.

### `GET /sites`

`{"hosts": ["101cookbooks.com", …]}`: every host the installed
`recipe-scrapers` has a scraper for, sorted, with no `www.`. Any other host is
read from its schema.org markup instead.

### `POST /fetch`

```
POST {{fetcher}}/fetch
Content-Type: application/json

{ "url": "https://www.seriouseats.com/..." }
```

```jsonc
{
  "title": "…",
  "language": "en",
  "yields": "4 servings",       // as written; the portion count is read out of it in Nuxt
  "image": "https://…",
  "totalTime": 45,              // minutes
  "siteName": "Serious Eats",
  "author": "…",
  "canonicalUrl": "https://…",  // the page's own, else the URL asked for
  "ingredients": [ … ],
  "steps": ["…"]
}
```

| Status | Meaning |
|---|---|
| 413 | The page is larger than the read limit |
| 415 | The URL served something that is not a web page |
| 422 | `url` missing or malformed, or no recipe on the page: no scraper for the site and no schema.org markup |
| 502 | The site errored, was unreachable, or redirected too many times |
| 504 | The site did not answer in time |

Every field but `canonicalUrl` and the two lists can be null. Only the first
200 ingredient lines are parsed.

**Only public addresses are fetched.** Every connection, redirects included,
has its host resolved once and is refused if any address is loopback, private,
link-local, CGNAT, multicast or reserved, or if the port is not 80 or 443. The
socket then goes to the address that was checked. A refusal is a **422**
("… is not a public address") naming the host, never the address. On a tunnel,
note that names resolve from inside the container, not from your laptop.

### `POST /instagram`

`{ "shortcode": "DbXWEUaxWVd" }` → the post's `url`, `author`, `caption` and
`images` (`{ mimeType, data }`, base64). Statuses and limits are in the
fetcher's README. Unlike `/fetch`, it cannot be pointed at a host: it takes a
shortcode, and reads media from Instagram's hosts only.

### `POST /ingredients`

```
POST {{fetcher}}/ingredients
Content-Type: application/json

{ "ingredients": ["1 1/2 cups milk", "2-3 tbsp olive oil"] }
```

At most 200 entries. Returns an array in the order given:

```jsonc
[
  {
    "originalText": "1 1/2 cups milk",   // the line as given, never normalised
    "name": "milk",
    "quantity": "1 1/2 cups",            // the amount as written
    "parsedQuantity": { "value": 1.5, "maxValue": null, "unit": "cup" },
    "extra": null
  }
]
```

`maxValue` is set only for a genuine range. `parsedQuantity` is null when the
amount could not be read, in which case the app parses the text itself.

The quickest endpoint in the stack and the one with no network of its own to
blame — a good first call when something upstream is failing and you want to
know whether the container is healthy.

---

## A smoke run, in order

Each step narrows where a failure is, so run them in this order and stop at the
first one that breaks.

| # | Call | Proves |
|---|---|---|
| 1 | `GET {{fetcher}}/health` | Tunnel works, fetcher container is up |
| 2 | `POST {{fetcher}}/ingredients` | It answers correctly, in milliseconds |
| 3 | `GET {{app}}/api/me` | The borrowed cookie is valid |
| 4 | `POST {{app}}/api/extract/website` | App → fetcher, over `recipeat-fetch-net` |
| 5 | `POST {{app}}/api/extract/text` | App → Gemini, over the internet |
| 6 | `POST {{app}}/api/extract/photo` | The same, carrying an image |
| 7 | `POST {{app}}/api/recipes` | App → Postgres, over `recipeat-db-net` |
| 8 | `GET {{app}}/api/recipes` | The row is there, and is yours |
| 9 | `POST {{app}}/api/recipes/{id}/progressions` | Lineage: the new version takes the pin, and step 8 shows it in place of the old one |
| 10 | `DELETE {{app}}/api/recipes/{id}` on step 9's id | The pin goes back to step 7's row, and step 8 shows it again |

A **503** at step 7 is not the database being down: it is `NUXT_DATABASE_URL`
missing from the app's environment. A 500 there, with the app otherwise
healthy, is worth checking the logs for — the migration runner refuses to
serve a schema it could not apply, so the container would be restarting.

A 502 at step 4 when the fetcher answered at steps 1–2 is a network problem
rather than a service one: the app reaches it over `recipeat-fetch-net` by the
alias its Compose file declares, never over the loopback port you tunnelled.

A 502 at step 5 or 6 is the model, and the app will not say which — upstream
bodies are logged, never forwarded, because they can name the project and the
key. Check the container logs. A **503** there is not a fault: it means busy or
over quota, and the same request will work shortly.

## What the errors will not tell you

Client-facing messages from the app are sanitized on purpose. Upstream response
bodies, host names and stack traces ride on the error's `cause`, which Nitro
logs server-side and never serializes. So a 502 in Postman is the beginning of
the answer, not the end — the rest is in `docker logs recipeat-app` on the VPS.
