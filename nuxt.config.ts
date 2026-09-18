export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  runtimeConfig: {
    ollamaBaseUrl: 'http://127.0.0.1:11434',
    ollamaModel: 'qwen3.5:2b',
    fetcherBaseUrl: 'http://127.0.0.1:8000',
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
        redirectUri: 'http://localhost:3000/auth/zitadel/callback',
        logoutRedirectUri: 'http://localhost:3000/',
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
