# API map

Every route the deployment answers on, arranged for testing by hand. The shapes
and the reasoning behind them live in [extraction.md](./extraction.md); this is
the operational view — what to point Postman at, and what stands in the way.

There are two tiers. The **app** is public and needs a session on four of its
five routes. The **fetcher** is unauthenticated and published on loopback only,
so reaching it at all takes a tunnel. Extraction itself runs at Google and is
not reachable from here. Nothing in either tier stores anything: every call is
safe to repeat.

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
| 413 | URL too long, or the page too large to read |
| 422 | No scraper for that site, no recipe on the page, or the URL serves something that is not a page |
| 502 | The site failed or was unreachable, or the fetcher could not be reached |
| 504 | The site did not answer in time |

**Seconds, not minutes** — no model runs on this path. It is the fastest way to
confirm the app is wired to a service at all.

Note the one deliberate remapping: the fetcher's own 415 (a URL serving a PDF)
arrives here as **422**, because that is a problem with what was asked for, not
with the content type of the asking.

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
| 422 | `url` missing or malformed, no scraper for the site, or no recipe on the page |
| 502 | The site errored, was unreachable, or redirected too many times |
| 504 | The site did not answer in time |

Every field but `canonicalUrl` and the two lists can be null. Only the first
200 ingredient lines are parsed.

**This endpoint will fetch any URL you give it.** There is no SSRF guard: no
address is resolved and checked, and redirects are followed wherever they
point. On a tunnel you are driving it from your laptop but it resolves from
inside the container, so treat what you send it as you would a request made
from the VPS itself.

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
