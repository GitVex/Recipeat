import { test, expect } from '@playwright/test'

// The filter lab (#87), a development page: reachable here because the
// container is built from a checkout's .env with NUXT_PUBLIC_LAB=1.
test('the filter lab applies what is typed to every size of the photo', async ({ page }) => {
  await page.goto('/lab/filters')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Filter lab')
  const photos = page.locator('.lab-pair img')
  await expect(photos).toHaveCount(4)
  // It opens on what the theme prints photos with.
  await expect(photos.first()).toHaveCSS('filter', /url\("?#lab-filter"?\) sepia\(0\.2\)/)
  expect(await page.locator('#lab-filter feTile').count()).toBe(4)

  // Typed primitives become the filter; the CSS chain follows them.
  await page.getByLabel('SVG filter primitives').fill('<feGaussianBlur stdDeviation="3" />')
  expect(await page.locator('#lab-filter feGaussianBlur').count()).toBe(1)
  await page.getByLabel('CSS filters after it').fill('')
  await expect(photos.first()).toHaveCSS('filter', /^url\("?#lab-filter"?\)$/)

  // The riso: four inks, each through its own screen, the screens shown by name.
  await page.getByLabel('Preset').selectOption('Single-ink halftone')
  expect(await page.locator('#lab-filter feTile').count()).toBe(1)
  await page.getByLabel('Preset').selectOption('Riso, four inks')
  await expect(page.getByLabel('SVG filter primitives')).toHaveValue(/\$SCREEN_27/)
  expect(await page.locator('#lab-filter feTile').count()).toBe(4)
  expect(await page.locator('#lab-filter feImage').first().getAttribute('href')).toMatch(/^data:image\/svg\+xml,/)

  // Its knobs write the filter: the yellow screen's tile is one dot across.
  const yellowTile = page.locator('#lab-filter feImage').first()
  await expect(yellowTile).toHaveAttribute('width', '1.5')
  await page.getByLabel('Dot spacing').fill('8')
  await expect(yellowTile).toHaveAttribute('width', '8')
  await page.getByLabel('yellow', { exact: true }).fill('#00ff00')
  await expect(page.locator('#lab-filter feColorMatrix[result="yellow-ink"]')).toHaveAttribute('values', /0 0 0 0 0 {2}0 0 0 0 1 {2}0 0 0 0 0 /)
  await page.getByRole('button', { name: 'Back to what the theme uses' }).click()
  await expect(yellowTile).toHaveAttribute('width', '1.5')

  await page.getByLabel('Preset').selectOption('No SVG filter')
  await expect(photos.first()).toHaveCSS('filter', 'none')
  await page.getByLabel('The original beside each').check()
  await expect(photos).toHaveCount(8)
})
