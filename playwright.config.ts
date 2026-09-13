import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  use: { channel: 'msedge', headless: true },
})
