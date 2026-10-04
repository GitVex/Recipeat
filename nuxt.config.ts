import { fileURLToPath } from 'node:url'
import { COMMUNITY } from './server/ingredients/community.ts'

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  // 8100 is the app; 8103 is the fetcher, the one service it still calls. The
  // block 8100-8103 stays reserved: 8101 and 8102 were Ollama and the OCR
  // service, and leaving the gap is cheaper than renumbering a deployment.
  devServer: { port: 8100 },
  runtimeConfig: {
    fetcherBaseUrl: 'http://127.0.0.1:8103',
    // Empty here and supplied as NUXT_DATABASE_URL. Postgres publishes on
    // loopback like the other services, so a checkout points at 127.0.0.1 and
    // a deployment at the container the compose file names.
    databaseUrl: '',
    // Empty here and supplied as NUXT_GEMINI_API_KEY: the only secret this
    // project has, and the only runtime value that must not be in the repo.
    geminiApiKey: '',
    geminiModel: 'gemini-3.8-flash',
    // SearXNG, for "Similar recipes elsewhere" (#59). No key: it's ours, on
    // recipeat-search-net. Empty turns the section into a quiet "not set up".
    searxngBaseUrl: 'http://127.0.0.1:8104',
    // How many cooks shared ingredient data takes (#147), as
    // NUXT_COMMUNITY_KEY_COOKS, NUXT_COMMUNITY_ALIAS_COOKS and
    // NUXT_COMMUNITY_SUBSTITUTION_COOKS.
    community: { ...COMMUNITY },
  },
  modules: ['nuxt-oidc-auth'],
  oidc: {
    defaultProvider: 'zitadel',
    middleware: { globalMiddlewareEnabled: false },
    providers: {
      zitadel: {
        baseUrl: '',
        clientId: '',
        authenticationScheme: 'none',
        redirectUri: 'http://localhost:8100/auth/zitadel/callback',
        logoutRedirectUri: 'http://localhost:8100/',
        scope: ['openid', 'profile', 'email', 'offline_access'],
        tokenValidationMode: 'strict',
        optionalClaims: ['sub'],
        filterUserInfo: ['sub', 'name', 'preferred_username', 'email'],
        additionalLogoutParameters: { clientId: '{clientId}', idTokenHint: '' },
        sessionConfiguration: { expirationThreshold: 60 },
      },
    },
  },
  nitro: {
    storage: { oidc: { driver: 'fs', base: './.data/oidc' } },
    // The migration runner reads these at startup. They are server assets
    // rather than a directory read because the built output is all that
    // reaches the container — server/ does not — and an asset is bundled into
    // it, so the same read works in a checkout and in the image.
    // Absolute: Nitro resolves a relative serverAssets dir against its own
    // srcDir, which under Nuxt is server/ — so a path written from the project
    // root silently matches nothing and bundles no migrations.
    serverAssets: [{ baseName: 'migrations', dir: fileURLToPath(new URL('./server/database/migrations', import.meta.url)) }],
  },
  css: ['~/assets/main.css'],
  app: {
    // One page fades out before the next fades in; the styles are in main.css.
    // Nested pages too, so opening another recipe in the collection crossfades.
    pageTransition: { name: 'page', mode: 'out-in' },
    head: {
      title: 'Recipeat — A little inspiration. A lot of good food.',
      meta: [{ name: 'description', content: 'Turn recipes from photos, websites, and little scraps of inspiration into your own beautiful recipe collection.' }],
      link: [
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=Playfair+Display:ital,wght@0,400;1,400&display=swap' }
      ]
    }
  }
})
