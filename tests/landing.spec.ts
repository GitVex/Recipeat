import { test, expect } from '@playwright/test'

test('recipe preview, saving, and collection persistence', async ({ page }) => {
  await page.goto('/')
  await page.screenshot({ path: 'test-results/desktop.png', fullPage: true })
  await expect(page.getByRole('heading', { level: 1 })).toContainText('inspiration')
  await page.getByRole('button', { name: 'View Creamy tomato & basil pasta' }).click()
  await expect(page.getByRole('dialog')).toContainText('Creamy tomato & basil pasta')
  await page.getByRole('button', { name: 'Save to my collection' }).click()
  await page.getByRole('button', { name: 'Close recipe' }).click()
  await page.reload()
  await page.getByRole('button', { name: 'View your collection' }).click()
  await expect(page.locator('.recipe-card')).toHaveCount(1)
  await page.getByRole('button', { name: 'Unsave Creamy tomato & basil pasta' }).click()
  await expect(page.getByText('Your next favorite belongs here.')).toBeVisible()
})

test('mobile layout and navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
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
