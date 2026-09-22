export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  // 8100 is the app; 8101-8103 are the three services it calls. The block is
  // kept contiguous so a port clash on the host is one range to check.
  devServer: { port: 8100 },
  runtimeConfig: {
    ollamaBaseUrl: 'http://127.0.0.1:8101',
    ollamaModel: 'qwen3.5:2b',
    fetcherBaseUrl: 'http://127.0.0.1:8103',
    ocrBaseUrl: 'http://127.0.0.1:8102',
    // Empty here and supplied as NUXT_GEMINI_API_KEY: the first secret this
    // project has, and the only runtime value that must not be in the repo.
    geminiApiKey: '',
    geminiModel: 'gemini-3.8-flash',
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
  },
  css: ['~/assets/main.css'],
  app: {
    head: {
      title: 'Recipeat — A little inspiration. A lot of good food.',
      meta: [{ name: 'description', content: 'Turn recipes from photos, websites, and little scraps of inspiration into your own beautiful recipe collection.' }],
      link: [
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;450;500;550;600;650;700&family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500&display=swap' }
      ]
    }
  }
})
