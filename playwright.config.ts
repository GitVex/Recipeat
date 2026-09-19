import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testIgnore: '**/auth/**',
  use: { baseURL: 'http://localhost:8100', channel: 'msedge', headless: true },
})
