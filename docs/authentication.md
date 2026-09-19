# Authentication

Zitadel login through `nuxt-oidc-auth`. The module owns the login, callback and
logout routes, Authorization Code + PKCE, state and nonce, strict ID-token
validation against discovery and JWKS, encrypted sessions, and refresh. Tokens
are never exposed to browser JavaScript.

Zitadel access tokens may be opaque, so the preset validates the ID token and
deliberately skips JWT validation of the access token.

## Zitadel application

Create a **Web** OIDC application using **PKCE**, with token endpoint
authentication method **None** — this needs a client ID, not a secret. Enable
the authorization-code and refresh-token grants (`offline_access` is requested
so sessions can refresh).

Register these URLs for development, exactly:

- Redirect: `http://localhost:8100/auth/zitadel/callback`
- Post-logout: `http://localhost:8100/`

Zitadel may need development mode enabled for HTTP on localhost. For production,
register the HTTPS equivalents on your domain, and prefer a separate application
from the development one.

## Local configuration

Copy `.env.example` to `.env` and fill in the Zitadel base URL and client ID.
Generate the three session secrets separately:

```sh
openssl rand -hex 32      # NUXT_OIDC_SESSION_SECRET
openssl rand -hex 32      # NUXT_OIDC_AUTH_SESSION_SECRET
openssl rand -base64 32   # NUXT_OIDC_TOKEN_KEY, exactly 32 random bytes
```

These encrypt the app's own sessions; they are not Zitadel credentials. Keep
them stable across restarts and out of version control. Without them the module
generates temporary defaults and no session survives a restart.

Then `npm run dev`, open `http://localhost:8100`, and select **Sign in** (inside
the menu on mobile).

## Deployment

Run the built server (`node .output/server/index.mjs`), not static hosting.
Set every `.env.example` variable as a **runtime environment variable** —
production does not read `.env`.

- Point both redirect variables at the externally visible HTTPS URLs, matching
  Zitadel exactly.
- Set `NODE_ENV=production` so session cookies are marked secure.
- Persist `.data/oidc`; it holds the encrypted server-side token sessions. For
  an app directory of `/app`, mount a volume at `/app/.data/oidc`.
- That filesystem session store assumes a single instance. Move to a shared
  Nitro storage driver such as Redis before running replicas.

## Writing private endpoints

```ts
import { requireUserSession } from 'nuxt-oidc-auth/runtime/server/utils/session.js'

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const session = await requireUserSession(event)
  return { subject: session.claims?.sub }
})
```

Set `Cache-Control` before the session check so the 401 carries it too.

Derive ownership from the verified subject (`session.claims.sub`) within the
configured issuer. Never trust a client-supplied user ID, and never use an email
address as the durable identity — it can change and be reassigned.

`GET /api/me` and `POST /api/extract/text` both follow this shape.

## Verification

`npm run build && npm run test:auth` runs the production bundle against a mock
issuer on ports 3100/3101. It generates throwaway secrets, overrides the
provider settings for the test server only, and contacts no real identity
provider. The suite covers login, PKCE, session persistence, refresh, logout,
and rejection of bad state, signature, issuer, audience, nonce and expiry.

It uses installed Microsoft Edge (`channel: 'msedge'`).

Those tests prove the integration, not your live Zitadel settings. Against the
real provider, check sign-in, reload persistence, `/api/me`, and sign-out, and
confirm that a denied login establishes no session.

References: [Zitadel provider](https://nuxtoidc.cloud/provider/zitadel),
[configuration](https://nuxtoidc.cloud/configuration),
[session security](https://nuxtoidc.cloud/getting-started/security),
[Zitadel Code + PKCE](https://zitadel.com/docs/guides/integrate/login/oidc/login-users).
