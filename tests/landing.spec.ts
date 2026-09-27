import { test, expect, type Page } from '@playwright/test'

// Before hydration a button does nothing and a link is a full page load, so a
// click that lands too early tests the server's HTML rather than the app.
const hydrated = (page: Page) => page.waitForFunction(() => !!(document.querySelector('#__nuxt') as any)?.__vue_app__)

test('the samples are there to look at, and nothing is kept in the browser', async ({ page }) => {
  // A collection from before #51 was a list of sample ids in localStorage.
  await page.addInitScript(() => localStorage.setItem('recipeat-saved', '["sample-pasta"]'))
  await page.goto('/')
  await hydrated(page)
  await page.screenshot({ path: 'test-results/desktop.png', fullPage: true })
  await expect(page.getByRole('heading', { level: 1 })).toContainText('inspiration')
  await page.getByRole('button', { name: 'View Creamy tomato & basil pasta' }).click()
  await expect(page.getByRole('dialog')).toContainText('Creamy tomato & basil pasta')
  await expect(page.getByRole('dialog').getByRole('button', { name: /collection/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Close recipe' }).click()
  await expect(page.getByRole('button', { name: /^(Save|Unsave) Creamy/ })).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('recipeat-saved'))).toBeNull()
})

test('mobile layout and navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await hydrated(page)
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Toggle navigation' }).click()
  await page.getByRole('link', { name: 'How it works' }).click()
  await expect(page.getByRole('button', { name: 'Toggle navigation' })).toHaveAttribute('aria-expanded', 'false')
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true })
})

// Signed out, the import button still opens the dialog, but what is in it is a
// reason to sign in and a way to do it: nothing that could reach an
// extraction route. The signed-in import flows are in tests/auth/oidc.spec.ts,
// which has a provider to sign in against.
test('signed out, the import dialog asks for a sign-in and keeps keyboard focus', async ({ page }) => {
  let extractions = 0
  await page.route('**/api/extract/**', route => { extractions++; return route.abort() })
  await page.goto('/')
  await hydrated(page)
  const trigger = page.getByRole('button', { name: 'Save your first recipe' })
  await trigger.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Sign in, and you can bring recipes in')
  await expect(dialog.getByRole('tab')).toHaveCount(0)
  await expect(dialog.getByText(/demo|sample/i)).toHaveCount(0)
  const close = page.getByRole('button', { name: 'Close import' })
  await expect(close).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(page.getByRole('button', { name: 'Sign in to continue' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(close).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(trigger).toBeFocused()
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden')
  expect(extractions).toBe(0)
})
