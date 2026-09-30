import { test, expect, type Page } from '@playwright/test'

// Keeping the screen on, against a stand-in for navigator.wakeLock: a headless
// browser has no screen to keep on, and a real one would not let a test refuse
// or drop the lock on cue.
const id = '11111111-1111-4111-8111-111111111111'
const recipe = {
  id, title: 'Focaccia', image: null, totalTime: 30, portions: 2, source_lang: 'en',
  ingredients: [{ id: 'ingredient_1', originalText: '500 g flour', name: 'flour', quantityText: '500 g', quantity: { value: 500, maxValue: null, unit: 'g' }, extra: null }],
  steps: [{ id: 'step_1', originalText: 'Bake.', parts: [{ type: 'text', value: 'Bake.' }], quantities: {} }],
  source: { type: 'text', originalText: '' },
  tags: [], lineId: id, progressionOf: null, variantOf: null, pinned: true,
  createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
}

type Fake = { requests: number, released: number, refuse: boolean, hidden: boolean }

async function open(page: Page) {
  await page.addInitScript(() => {
    const fake = { requests: 0, released: 0, refuse: false, hidden: false, held: null as any }
    ;(window as any).__wake = fake
    Object.defineProperty(document, 'visibilityState', { get: () => (fake.hidden ? 'hidden' : 'visible') })
    Object.defineProperty(navigator, 'wakeLock', {
      value: {
        async request() {
          fake.requests++
          if (fake.refuse) throw new DOMException('Battery low', 'NotAllowedError')
          const lock = { released: false, async release() { if (!lock.released) { lock.released = true; fake.released++ } } }
          return (fake.held = lock)
        },
      },
    })
  })
  await page.route('**/api/recipes', route => route.fulfill({ json: { recipes: [{ ...recipe, ingredientCount: 1, stepCount: 1 }] } }))
  await page.route('**/api/recipes/*', route => route.fulfill({ json: { recipe } }))
  await page.goto('/')
  await page.waitForFunction(() => !!(document.querySelector('#__nuxt') as any)?.__vue_app__)
  await page.getByRole('navigation').getByRole('link', { name: /My recipes/ }).click()
  await page.locator('.collection-entry').first().click()
  await expect(page).toHaveURL(`/recipes/${id}`)
}

const fake = (page: Page) => page.evaluate(() => (window as any).__wake as Fake)
const toggle = (page: Page) => page.getByRole('switch', { name: 'Keep screen on' })

test('the screen is kept on, asked for again when the page comes back, and let go', async ({ page }) => {
  await open(page)
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'false')
  await toggle(page).click()
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'true')
  expect((await fake(page)).requests).toBe(1)

  // Hidden, the browser drops the lock itself; back, it is asked for again.
  await page.evaluate(() => {
    const wake = (window as any).__wake
    wake.hidden = true
    wake.held.released = true
    document.dispatchEvent(new Event('visibilitychange'))
    wake.hidden = false
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect.poll(async () => (await fake(page)).requests).toBe(2)
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'true')

  await toggle(page).press('Space')
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'false')
  expect((await fake(page)).released).toBe(1)
})

test('a refused request turns the switch back off and says why', async ({ page }) => {
  await open(page)
  await page.evaluate(() => { (window as any).__wake.refuse = true })
  await toggle(page).click()
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'false')
  await expect(page.getByRole('alert')).toContainText('wouldn’t keep the screen on')
})

test('leaving the recipe lets the screen sleep', async ({ page }) => {
  await open(page)
  await toggle(page).click()
  await expect.poll(async () => (await fake(page)).requests).toBe(1)
  await page.getByRole('navigation').getByRole('link', { name: /My recipes/ }).click()
  await expect.poll(async () => (await fake(page)).released).toBe(1)
})
