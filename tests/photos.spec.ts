import { test, expect, type Page, type Request } from '@playwright/test'

// Photos of a version (#45), against a mocked API: the strip in order with
// its cover, an arrangement sent whole, a picture shrunk in the browser before
// it goes, the eleventh refused before any upload, and the kept source page.
const id = '33333333-3333-4333-8333-333333333333'
const recipe = {
  id, title: 'Focaccia', image: null, totalTime: 30, portions: 2, source_lang: 'en',
  ingredients: [{ id: 'ingredient_1', originalText: '500 g flour', name: 'flour', quantityText: '500 g', quantity: { value: 500, maxValue: null, unit: 'g' }, extra: null }],
  steps: [{ id: 'step_1', originalText: 'Bake.', parts: [{ type: 'text', value: 'Bake.' }], quantities: {} }],
  source: { type: 'photo', originalFilename: 'page.jpg' },
  tags: [], lineId: id, progressionOf: null, variantOf: null, pinned: true,
  createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
}
const photo = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
// A 1×1 PNG: something a canvas can draw.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

async function open(page: Page, photos: { photos: { id: string, cover: boolean }[], source: string | null }) {
  const writes: Request[] = []
  await page.route('**/api/recipes', route => route.fulfill({ json: { recipes: [{ ...recipe, ingredientCount: 1, stepCount: 1 }] } }))
  await page.route('**/api/recipes/*', route => route.fulfill({ json: { recipe } }))
  await page.route('**/api/images/*', route => route.fulfill({ body: png, contentType: 'image/png' }))
  await page.route('**/api/recipes/*/photos', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: photos })
    writes.push(route.request())
    return route.fulfill({ json: photos })
  })
  await page.goto('/')
  await page.waitForFunction(() => !!(document.querySelector('#__nuxt') as any)?.__vue_app__)
  await page.getByRole('navigation').getByRole('link', { name: /My recipes/ }).click()
  await page.locator('.collection-entry').first().click()
  await expect(page).toHaveURL(`/recipes/${id}`)
  return writes
}

test('the strip shows each photo in order, and an arrangement goes whole', async ({ page }) => {
  const writes = await open(page, { photos: [{ id: photo(1), cover: true }, { id: photo(2), cover: false }], source: null })
  const items = page.locator('.photo-item')
  await expect(items).toHaveCount(2)
  await expect(items.first().locator('.photo-cover')).toHaveText('Cover')
  await expect(page.getByText('2 of 10')).toBeVisible()

  await items.nth(1).getByRole('button', { name: 'Make cover' }).click()
  await expect.poll(() => writes.length).toBe(1)
  expect(writes[0]!.method()).toBe('PUT')
  expect(writes[0]!.postDataJSON()).toEqual({ order: [photo(1), photo(2)], cover: photo(2) })

  await page.getByRole('button', { name: 'Move photo 2 earlier' }).click()
  await expect.poll(() => writes.length).toBe(2)
  expect(writes[1]!.postDataJSON()).toEqual({ order: [photo(2), photo(1)], cover: photo(1) })
})

test('an added photo is shrunk to a JPEG and its thumb before it is sent', async ({ page }) => {
  const writes = await open(page, { photos: [], source: null })
  await page.locator('.photo-add input').setInputFiles({ name: 'dish.png', mimeType: 'image/png', buffer: png })
  await expect.poll(() => writes.length).toBe(1)
  expect(writes[0]!.method()).toBe('POST')
  const body = writes[0]!.postDataBuffer()!.toString('latin1')
  expect(body).toContain('name="image"; filename="image.jpg"')
  expect(body).toContain('name="thumb"; filename="thumb.jpg"')
  expect(body).toContain('Content-Type: image/jpeg')
  // JPEG bytes, not the PNG that was chosen.
  expect(body).not.toContain('PNG')
})

test('ten photos refuse an eleventh before anything is uploaded', async ({ page }) => {
  await open(page, { photos: Array.from({ length: 10 }, (_, n) => ({ id: photo(n + 1), cover: n === 0 })), source: null })
  await expect(page.locator('.photo-item')).toHaveCount(10)
  await expect(page.getByText('Ten photos is the most a version can have.')).toBeVisible()
  await expect(page.locator('.photo-add')).toHaveCount(0)
})

test('a kept source page is shown beside the photos', async ({ page }) => {
  await open(page, { photos: [], source: photo(99) })
  await expect(page.getByRole('img', { name: 'The page this recipe was imported from' })).toHaveAttribute('src', `/api/images/${photo(99)}?size=thumb`)
})
