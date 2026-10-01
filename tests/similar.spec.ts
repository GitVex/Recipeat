import { test, expect, type Page } from '@playwright/test'

// "Similar recipes elsewhere" (#59), against a mocked API: folded, searched
// on first opening and not before, three cards that open in a new tab, and a
// failure that stays inside the section.
const id = '22222222-2222-4222-8222-222222222222'
const recipe = {
  id, title: 'Carbonara', image: null, totalTime: 30, portions: 2, source_lang: 'en',
  ingredients: [{ id: 'ingredient_1', originalText: '200 g spaghetti', name: 'spaghetti', quantityText: '200 g', quantity: { value: 200, maxValue: null, unit: 'g' }, extra: null }],
  steps: [{ id: 'step_1', originalText: 'Cook.', parts: [{ type: 'text', value: 'Cook.' }], quantities: {} }],
  source: { type: 'text', originalText: '' },
  tags: [], lineId: id, progressionOf: null, variantOf: null, pinned: true,
  createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
}
const results = ['a.com', 'b.com', 'c.com'].map(site => ({ title: `Carbonara at ${site}`, url: `https://${site}/carbonara`, site, snippet: 'Eggs, cheese, guanciale.' }))

async function open(page: Page, answer: () => object | number) {
  const searches: string[] = []
  await page.route('**/api/recipes', route => route.fulfill({ json: { recipes: [{ ...recipe, ingredientCount: 1, stepCount: 1 }] } }))
  await page.route('**/api/recipes/*', route => route.fulfill({ json: { recipe } }))
  await page.route('**/api/recipes/*/similar', (route) => {
    searches.push(route.request().url())
    const body = answer()
    return typeof body === 'number' ? route.fulfill({ status: body, json: {} }) : route.fulfill({ json: body })
  })
  await page.goto('/')
  await page.waitForFunction(() => !!(document.querySelector('#__nuxt') as any)?.__vue_app__)
  await page.getByRole('navigation').getByRole('link', { name: /My recipes/ }).click()
  await page.locator('.collection-entry').first().click()
  await expect(page).toHaveURL(`/recipes/${id}`)
  return searches
}

const toggle = (page: Page) => page.getByRole('button', { name: /Similar recipes elsewhere/ })

test('folded until asked, then three links out, searched once', async ({ page }) => {
  const searches = await open(page, () => ({ results }))
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false')
  await expect(toggle(page)).toContainText('powered by SearXNG')
  expect(searches).toHaveLength(0)

  await toggle(page).click()
  const cards = page.locator('.similar-card')
  await expect(cards).toHaveCount(3)
  await expect(cards.first()).toHaveAttribute('href', 'https://a.com/carbonara')
  await expect(cards.first()).toHaveAttribute('target', '_blank')
  await expect(cards.first()).toContainText('a.com')

  await toggle(page).click()
  await toggle(page).click()
  await expect(cards).toHaveCount(3)
  expect(searches).toHaveLength(1)
})

test('a failed search says so in the section and can be tried again', async ({ page }) => {
  let fail = true
  await open(page, () => (fail ? 502 : { results: [] }))
  await toggle(page).click()
  await expect(page.getByText('The search didn’t work this time.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Carbonara' }).first()).toBeVisible()

  fail = false
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByText('Nothing similar turned up.')).toBeVisible()
})
