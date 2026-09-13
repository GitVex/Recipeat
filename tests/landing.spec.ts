import { test, expect } from '@playwright/test'

test('recipe preview, saving, and collection persistence', async ({ page }) => {
  await page.goto('http://localhost:3000')
  await page.screenshot({ path: 'test-results/desktop.png', fullPage: true })
  await expect(page.getByRole('heading', { level: 1 })).toContainText('inspiration')
  await page.getByRole('button', { name: 'Save your first recipe' }).click()
  await page.getByLabel('Recipe URL').fill('https://example.com/pasta')
  await page.getByRole('button', { name: 'Preview a sample recipe' }).click()
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
  await page.goto('http://localhost:3000')
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'Toggle navigation' }).click()
  await page.getByRole('link', { name: 'How it works' }).click()
  await expect(page.getByRole('button', { name: 'Toggle navigation' })).toHaveAttribute('aria-expanded', 'false')
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true })
})
