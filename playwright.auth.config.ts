import { randomBytes } from 'node:crypto'
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  workers: 1,
  use: { baseURL: 'http://localhost:3100', channel: 'msedge', headless: true },
  webServer: {
    command: 'node .output/server/index.mjs',
    url: 'http://localhost:3100',
    reuseExistingServer: false,
    env: {
      NODE_ENV: 'test', // HTTP-only fixture; production uses secure cookies.
      PORT: '3100',
      NUXT_OIDC_PROVIDERS_ZITADEL_BASE_URL: 'http://localhost:3101',
      NUXT_OIDC_PROVIDERS_ZITADEL_CLIENT_ID: 'recipeat-test',
      NUXT_OIDC_PROVIDERS_ZITADEL_REDIRECT_URI: 'http://localhost:3100/auth/zitadel/callback',
      NUXT_OIDC_PROVIDERS_ZITADEL_LOGOUT_REDIRECT_URI: 'http://localhost:3100/',
      NUXT_OIDC_PROVIDERS_ZITADEL_OPEN_ID_CONFIGURATION: 'http://localhost:3101/.well-known/openid-configuration',
      NUXT_OIDC_SESSION_SECRET: randomBytes(32).toString('hex'),
      NUXT_OIDC_AUTH_SESSION_SECRET: randomBytes(32).toString('hex'),
      NUXT_OIDC_TOKEN_KEY: randomBytes(32).toString('base64'),
    },
  },
})
