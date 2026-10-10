import { readFileSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'

// A browser's reading mode on the recipe page (#97). Firefox's Reader View is
// Mozilla's Readability run on a copy of the page; it is offered when
// isProbablyReaderable says so, with Firefox's own visibility check. Both run
// here on the page as rendered. Safari's Reader is its own and is not.
const READABILITY = readFileSync('node_modules/@mozilla/readability/Readability.js', 'utf8')
const READERABLE = readFileSync('node_modules/@mozilla/readability/Readability-readerable.js', 'utf8')

const id = '33333333-3333-4333-8333-333333333333'
const text = (value: string) => ({ type: 'text', value })
const focaccia = {
  id, title: 'Focaccia', image: null, totalTime: 90, portions: 2, source_lang: 'en',
  ingredients: [
    { id: 'ingredient_1', originalText: '500 g flour', name: 'flour', quantityText: '500 g', quantity: { value: 500, maxValue: null, unit: 'g' }, extra: 'type 00' },
    { id: 'ingredient_2', originalText: '1 tsp salt', name: 'salt', quantityText: '1 tsp', quantity: { value: 1, maxValue: null, unit: 'tsp' }, extra: null },
    { id: 'ingredient_3', originalText: 'olive oil to taste', name: 'olive oil', quantityText: null, quantity: null, extra: 'to taste' },
  ],
  steps: [
    {
      id: 'step_1', originalText: 'Mix 500 g flour with the salt and 350 ml of warm water until no dry flour is left in the bowl.',
      parts: [text('Mix '), { type: 'ingredientQuantity', ingredientId: 'ingredient_1' }, text(' flour with the salt and 350 ml of warm water until no dry flour is left in the bowl.')],
      quantities: {},
    },
    { id: 'step_1b', originalText: 'Knead it on the counter for ten minutes, stretching and folding, until the dough is smooth, springy and only a little sticky.', parts: [text('Knead it on the counter for ten minutes, stretching and folding, until the dough is smooth, springy and only a little sticky.')], quantities: {} },
    { id: 'step_1c', originalText: 'Shape it into a ball, put it back in the bowl and drizzle a little olive oil over it so the top does not dry out.', parts: [text('Shape it into a ball, put it back in the bowl and drizzle a little olive oil over it so the top does not dry out.')], quantities: {} },
    { id: 'step_2', originalText: 'Cover the bowl and leave the dough to rise somewhere warm for an hour, until it has doubled in size.', parts: [text('Cover the bowl and leave the dough to rise somewhere warm for an hour, until it has doubled in size.')], quantities: {} },
    {
      id: 'step_3', originalText: 'Press it into an oiled tin, dimple it with your fingers, and bake at 220 °C for 20 min until golden.',
      parts: [text('Press it into an oiled tin, dimple it with your fingers, and bake at '), { type: 'measurement', quantity: 'temperature_1' }, text(' for 20 min until golden.')],
      quantities: { temperature_1: { value: 220, maxValue: null, unit: 'celsius', kind: 'temperature', scaleWithPortions: false } },
    },
  ],
  source: { type: 'text', originalText: '' },
  tags: ['bread'], lineId: id, progressionOf: null, variantOf: null, pinned: true,
  createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
}

async function open(page: Page) {
  await page.route('**/api/recipes', route => route.fulfill({ json: { recipes: [{ ...focaccia, ingredientCount: 3, stepCount: 5 }] } }))
  await page.route('**/api/recipes/*', route => route.fulfill({ json: { recipe: focaccia } }))
  await page.goto('/')
  await page.waitForFunction(() => !!(document.querySelector('#__nuxt') as any)?.__vue_app__)
  await page.getByRole('navigation').getByRole('link', { name: /My recipes/ }).click()
  await page.locator('.collection-entry').first().click()
  await expect(page).toHaveURL(`/recipes/${id}`)
  await expect(page.locator('.step-list li')).toHaveCount(5)
}

async function reader(page: Page) {
  await page.addScriptTag({ content: READABILITY })
  await page.addScriptTag({ content: READERABLE })
  return page.evaluate(() => {
    const squash = (text: string | null) => (text ?? '').replace(/\s+/g, ' ').trim()
    // Firefox's own check, from its Readerable.js: a node counts if it takes up room.
    const offered = (window as any).isProbablyReaderable(document, (node: HTMLElement) => node.clientHeight > 0 && node.clientWidth > 0)
    const article = new (window as any).Readability(document.cloneNode(true)).parse()
    const shown = document.createElement('div')
    shown.innerHTML = article?.content ?? ''
    return {
      offered,
      blocks: [...shown.querySelectorAll('h1, h2, p, li')].filter(node => !node.querySelector('p')).map(node => squash(node.textContent)),
    }
  })
}

const steps = focaccia.steps.map(step => step.originalText)

test('Reader is offered, and shows the title, servings, time, every ingredient and every step, and nothing else', async ({ page }) => {
  await open(page)
  const { offered, blocks } = await reader(page)
  expect(offered).toBe(true)
  expect(blocks).toEqual([
    'Focaccia',
    'Serves 2 · 1 h 30 min',
    'Ingredients', '500 g flour, type 00', '1 tsp salt', 'olive oil, to taste',
    'Steps', ...steps,
  ])
})

test('Reader shows the amounts the page shows, with "not scaled" beside them', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: 'More servings' }).click()
  await expect(page.getByRole('group', { name: 'Servings' })).toContainText('Serves 3')
  const { blocks } = await reader(page)
  expect(blocks.slice(1, 6)).toEqual(['Serves 3 · 1 h 30 min', 'Ingredients', '750 g flour, type 00', '1½ tsp salt', 'olive oil, to taste (not scaled)'])
  expect(blocks).toContain(steps[0]!.replace('500 g', '750 g'))
})

test('the copy for Reader is out of sight and out of the accessibility tree', async ({ page }) => {
  await open(page)
  const copy = page.locator('#reader-article')
  await expect(copy).toHaveAttribute('inert', '')
  expect(await copy.evaluate(node => node.getBoundingClientRect().width)).toBeLessThanOrEqual(1)
  // What a screen reader is given: the browser's own accessibility tree, in
  // which an inert subtree is ignored. The recipe is in it once.
  // "Steps" and the servings line are the copy's own words, not the page's.
  const cdp = await page.context().newCDPSession(page)
  const told = async () => {
    const { nodes } = await cdp.send('Accessibility.getFullAXTree') as { nodes: { ignored: boolean, name?: { value: string } }[] }
    return nodes.filter(node => !node.ignored && ['Steps', 'Serves 2 · 1 h 30 min'].includes(node.name?.value ?? '')).length
  }
  expect(await told()).toBe(0)
  // And it is inert that keeps them out.
  await copy.evaluate(node => node.removeAttribute('inert'))
  expect(await told()).toBeGreaterThan(0)
  await copy.evaluate(node => node.setAttribute('inert', ''))
  await page.emulateMedia({ media: 'print' })
  await expect(copy).toBeHidden()
})

test('with reduced motion asked for, nothing on the recipe page moves', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await open(page)
  const moving = await page.evaluate(() => [...document.querySelectorAll('*')].filter((node) => {
    const style = getComputedStyle(node)
    return style.transitionDuration.split(',').some(value => parseFloat(value) > 0)
      || (style.animationName !== 'none' && style.animationDuration.split(',').some(value => parseFloat(value) > 0))
  }).map(node => node.className))
  expect(moving).toEqual([])
})
