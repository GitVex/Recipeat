# Zitadel authentication

Authentication is handled by `nuxt-oidc-auth` with its Zitadel provider. The module owns the login/callback/logout routes, Authorization Code + PKCE, state and nonce, strict ID-token validation against discovery/JWKS, encrypted sessions, and refresh. Zitadel access tokens may be opaque; the preset deliberately skips JWT validation of access tokens while validating the ID token. Tokens are not exposed to browser JavaScript.

## Zitadel setup

In your Zitadel project, create a **Web** OIDC application using **PKCE**, with token endpoint authentication method **None**. This configuration needs a client ID, not a client secret. Enable the authorization-code and refresh-token grants (`offline_access` is requested for session refresh).

Register these exact URLs for development:

- Redirect URI: `http://localhost:3000/auth/zitadel/callback`
- Post-logout redirect URI: `http://localhost:3000/`

Enable Zitadel's development mode for HTTP localhost if required. For production, register corresponding HTTPS URLs with your Recipeat domain. Prefer separate development and production applications. Users must have whatever project access your Zitadel project requires.

## Local configuration

Use Node.js **22.19+** (or a supported newer LTS); the authentication module's dependency requires it.

Copy `.env.example` to `.env` and supply the Zitadel base URL and client ID. Generate the three independent session secrets using these commands on your VPS (or any machine with OpenSSL):

```sh
# NUXT_OIDC_SESSION_SECRET
openssl rand -hex 32
# NUXT_OIDC_AUTH_SESSION_SECRET
openssl rand -hex 32
# NUXT_OIDC_TOKEN_KEY: exactly 32 random bytes, base64-encoded
openssl rand -base64 32
```

Put the resulting values in their corresponding variables. These are app session-encryption keys, not Zitadel credentials. Keep them stable across restarts and private; do not commit `.env`.

```sh
npm install
npm run dev
```

Open `http://localhost:3000` and select **Sign in** (inside the menu on mobile). Zitadel hosts the login screen; successful authentication returns to the landing page and displays your name and **Sign out**. Sign out clears the app session and redirects through Zitadel's end-session endpoint with the stored ID-token hint.

## Coolify deployment

Use a running Nuxt server (`npm run build`, then `node .output/server/index.mjs`), not static `nuxt generate` hosting. Set all `.env.example` variables as **runtime environment variables** in the Recipeat resource. Production does not automatically read `.env`.

- Set both redirect variables to the externally visible HTTPS URLs, matching Zitadel exactly.
- Run with `NODE_ENV=production` for secure session cookies.
- Persist the app's `.data/oidc` directory in Coolify. For an app working directory `/app`, mount a persistent volume at `/app/.data/oidc`. It holds encrypted server-side token sessions.
- Set the same three secrets for every restart. Without configured secrets, the package generates temporary defaults and sessions will not survive restarts.
- This filesystem configuration is for one app instance. Use a shared Nitro storage driver such as Redis before scaling to multiple replicas.

## Application boundaries

The landing page and recipe demo stay public. The mock collection still uses browser-local storage and is not an account-specific database. Login does not yet associate those recipes with a user.

`GET /api/me` demonstrates a server-enforced authenticated endpoint: it returns 401 without a valid session and returns only identity/profile fields when signed in. Import `requireUserSession` from `nuxt-oidc-auth/runtime/server/utils/session.js` and call `await requireUserSession(event)` in future private recipe/import endpoints too. Derive ownership from the verified subject (`session.claims.sub`) within the configured issuer; never trust a client-supplied user ID or use an email address as the durable identity.

## Verification

With your Zitadel settings configured, check sign-in, reload persistence, `/api/me`, and sign-out. Denying login or submitting an invalid callback must not establish a session. The app also has offline browser tests using a local mock issuer; these do not prove your live Zitadel application settings are correct.

Run `npm run build` followed by `npm run test:auth` to test the production bundle with a local mock issuer on ports 3100/3101, plus the landing-page regressions. The browser tests currently use installed Microsoft Edge (`channel: 'msedge'` in Playwright configuration). They generate temporary test secrets and override the provider settings only for the test server; no real identity provider is contacted.

References: [Nuxt OIDC Auth Zitadel provider](https://nuxtoidc.cloud/provider/zitadel), [configuration](https://nuxtoidc.cloud/configuration), [session security](https://nuxtoidc.cloud/getting-started/security), [Zitadel Code + PKCE](https://zitadel.com/docs/guides/integrate/login/oidc/login-users).
