import { test, expect, type Page, type Route } from '@playwright/test'

// A recipe's own history (#31), against a mocked API. The server's walk of a
// line is tests/database.live.ts's business; here a line is written by hand
// and the test checks what the page draws from it and what it asks for.
const id = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`

type Row = {
  id: string, title: string | null, lineId: string, progressionOf: string | null, variantOf: string | null,
  pinned: boolean, createdAt: string,
}
const row = (n: number, title: string, extra: Partial<Row> = {}): Row => ({
  id: id(n), title, lineId: id(n), progressionOf: null, variantOf: null, pinned: true,
  createdAt: `2026-09-${String(n).padStart(2, '0')}T12:00:00.000Z`, ...extra,
})
const full = (r: Row) => ({
  ...r, image: null, totalTime: null, portions: 2, source_lang: 'en',
  ingredients: [{ id: 'ingredient_1', originalText: '500 g flour', name: 'flour', quantityText: '500 g', quantity: { value: 500, maxValue: null, unit: 'g' }, extra: null }],
  steps: [{ id: 'step_1', originalText: 'Bake.', parts: [{ type: 'text', value: 'Bake.' }], quantities: {} }],
  source: { type: 'text', originalText: '' }, updatedAt: r.createdAt,
})
const card = (r: Row) => ({ id: r.id, title: r.title, image: null, totalTime: null, portions: 2, ingredientCount: 1, stepCount: 1, createdAt: r.createdAt, updatedAt: r.createdAt })

// What the server would answer for a line, from the rows the test holds.
function historyOf(rows: Map<string, Row>, of: string) {
  const lineId = rows.get(of)!.lineId
  const line = [...rows.values()].filter(r => r.lineId === lineId).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const ids = new Set(line.map(r => r.id))
  const variants = [...rows.values()].filter(r => r.variantOf && ids.has(r.variantOf)).map((variant) => {
    const entry = [...rows.values()].find(r => r.lineId === variant.id && r.pinned) ?? variant
    return { id: entry.id, title: entry.title, createdAt: variant.createdAt, variantOf: variant.variantOf }
  })
  const from = rows.get(lineId)?.variantOf
  return {
    lineId,
    versions: line.map(r => ({ id: r.id, title: r.title, progressionOf: r.progressionOf, pinned: r.pinned, ingredientCount: 1, stepCount: 1, createdAt: r.createdAt, updatedAt: r.createdAt })),
    variants,
    origin: from && rows.has(from) ? { id: from, title: rows.get(from)!.title } : null,
  }
}

type Handler = (route: Route, target: string, url: URL) => Promise<void> | void
async function mockApi(page: Page, rows: Map<string, Row>, write: Handler = route => route.abort()) {
  const reads: string[] = []
  await page.route('**/api/recipes', route => route.fulfill({ json: { recipes: [...rows.values()].filter(r => r.pinned).map(card) } }))
  await page.route(/\/api\/recipes\/[^/?]+(\/(history|pin))?(\?.*)?$/, (route) => {
    const url = new URL(route.request().url())
    const [, , , target, sub] = url.pathname.split('/')
    const method = route.request().method()
    if (method === 'GET' && sub === 'history') {
      return rows.has(target!) ? route.fulfill({ json: { history: historyOf(rows, target!) } }) : route.fulfill({ status: 404, json: {} })
    }
    if (method === 'GET') {
      reads.push(target!)
      const r = rows.get(target!)
      return r ? route.fulfill({ json: { recipe: full(r) } }) : route.fulfill({ status: 404, json: {} })
    }
    return write(route, target!, url)
  })
  return reads
}

const open = async (page: Page, title: string) => {
  await page.goto('/')
  await page.waitForFunction(() => !!(document.querySelector('#__nuxt') as any)?.__vue_app__)
  await page.getByRole('navigation').getByRole('link', { name: /My collection/ }).click()
  await page.locator('.collection-entry', { hasText: title }).click()
  await expect(page.locator('#open-recipe-title')).toContainText(title)
}
const history = (page: Page) => page.getByRole('region', { name: /History/ })
const toggle = (page: Page) => page.getByRole('button', { name: /^History/ })
const toast = (page: Page) => page.locator('.toast')
// A version's own row. Its list item holds everything made from it, too.
const version = (page: Page, title: string) => history(page).locator('.history-row').filter({ hasText: title })
const pins = (page: Page) => history(page).locator('.history-tag.pinned')

// Bread: an original, a second version, and two made from the second — one
// of them pinned. A separate recipe branched off the original, and has moved
// on to a second version of its own.
function bread() {
  return new Map<string, Row>([
    [id(1), row(1, 'Bread', { pinned: false })],
    [id(2), row(2, 'Bread, wetter', { lineId: id(1), progressionOf: id(1), pinned: false })],
    [id(3), row(3, 'Bread, rye', { lineId: id(1), progressionOf: id(2), pinned: false })],
    [id(4), row(4, 'Bread, spelt', { lineId: id(1), progressionOf: id(2) })],
    [id(5), row(5, 'Flatbread', { variantOf: id(1), pinned: false })],
    [id(6), row(6, 'Flatbread, charred', { lineId: id(5), progressionOf: id(5) })],
  ])
}

test('a recipe with no history shows none', async ({ page }) => {
  const rows = new Map([[id(1), row(1, 'Toast')]])
  let asked = false
  await mockApi(page, rows)
  page.on('request', request => request.url().endsWith('/history') && (asked = true))
  await open(page, 'Toast')
  await expect.poll(() => asked).toBe(true)
  await expect(page.locator('.collection-pane')).toContainText('500 g flour')
  await expect(toggle(page)).toHaveCount(0)
  await expect(page.locator('.earlier-version')).toHaveCount(0)
})

test('the history is a tree: both branches of a fork, the pin, and what branched off', async ({ page }) => {
  const reads = await mockApi(page, bread())
  await open(page, 'Bread, spelt')
  // Quiet until asked: the recipe on the page is the one the collection shows.
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false')
  await expect(toggle(page)).toContainText('4 versions, 1 separate recipe')
  await toggle(page).click()
  const panel = history(page)
  await expect(panel).toContainText('changing one never changes the versions made from it')

  const versions = panel.locator('.history-version')
  await expect(versions).toHaveCount(4)
  // A fork is two lists side by side, not a list of four.
  const fork = panel.getByRole('list', { name: '2 versions made from Version 2' })
  await expect(fork.locator(':scope > li')).toHaveCount(2)
  await expect(fork).toContainText('Bread, rye')
  await expect(fork).toContainText('Bread, spelt')

  const spelt = version(page, 'Bread, spelt')
  await expect(spelt).toContainText('Open now')
  await expect(spelt).toContainText('In your collection')
  await expect(pins(page)).toHaveCount(1)
  // The pinned version has nothing to pin; every other one does.
  await expect(panel.getByRole('button', { name: /^Pin / })).toHaveCount(3)
  await expect(panel.getByRole('button', { name: /^Delete / })).toHaveCount(4)

  // The separate recipe hangs off the version it came from, by its own entry
  // point, and none of its own history is here.
  const original = versions.first()
  await expect(original).toContainText('Original')
  const variant = original.locator('.history-variants')
  await expect(variant).toContainText('Separate recipe')
  await expect(variant.getByRole('link', { name: 'Flatbread, charred' })).toHaveAttribute('href', `/recipes/${id(6)}`)
  await expect(panel).not.toContainText(/Flatbread(?!, charred)/)

  // Each version is its card; only the one on the page was read in full.
  expect(reads.filter(read => read !== id(4))).toEqual([])
  await page.screenshot({ path: 'test-results/history-tree.png', fullPage: true })
})

test('an earlier version is readable, says what it is, and can be pinned', async ({ page }) => {
  const rows = bread()
  const pinned: string[] = []
  await mockApi(page, rows, (route, target, url) => {
    expect(route.request().method()).toBe('PUT')
    expect(url.pathname).toBe(`/api/recipes/${target}/pin`)
    pinned.push(target)
    for (const [key, r] of rows) if (r.lineId === rows.get(target)!.lineId) rows.set(key, { ...r, pinned: key === target })
    return route.fulfill({ json: { pinned: target, lineId: id(1) } })
  })
  await open(page, 'Bread, spelt')
  await toggle(page).click()
  await history(page).getByRole('link', { name: 'Bread, wetter' }).click()
  await expect(page).toHaveURL(`/recipes/${id(2)}`)
  await expect(page.locator('#open-recipe-title')).toContainText('Bread, wetter')
  await expect(page.locator('.collection-pane')).toContainText('500 g flour')

  // Said before anything is changed, and the history is already open.
  const note = page.getByRole('note')
  await expect(note).toContainText('An earlier version')
  await expect(note).toContainText('Changes saved here stay with this one')
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true')
  await page.screenshot({ path: 'test-results/history-earlier.png', fullPage: true })

  await note.getByRole('button', { name: 'Pin this version' }).click()
  await expect(toast(page)).toContainText('Your collection shows this version now')
  expect(pinned).toEqual([id(2)])
  await expect(page.getByRole('note')).toHaveCount(0)
  await expect(version(page, 'Bread, wetter')).toContainText('In your collection')
  await expect(pins(page)).toHaveCount(1)
  // The collection's entry for the line is this version now.
  await expect(page.locator('.collection-entry', { hasText: 'Bread' }).first()).toHaveAttribute('href', `/recipes/${id(2)}`)
})

test('any version can be pinned from the history, not only the one on the page', async ({ page }) => {
  const rows = bread()
  await mockApi(page, rows, (route, target) => {
    for (const [key, r] of rows) if (r.lineId === id(1)) rows.set(key, { ...r, pinned: key === target })
    return route.fulfill({ json: { pinned: target, lineId: id(1) } })
  })
  await open(page, 'Bread, spelt')
  await toggle(page).click()
  await history(page).getByRole('button', { name: 'Pin Version 3' }).click()
  await expect(toast(page)).toContainText('Your collection shows this version now')
  // This page is the earlier one now, and says so.
  await expect(page.getByRole('note')).toContainText('An earlier version')
  await expect(version(page, 'Bread, rye')).toContainText('In your collection')
  await expect(pins(page)).toHaveCount(1)
})

test('a pin that fails says so, and the pin stays where it was', async ({ page }) => {
  await mockApi(page, bread(), route => route.fulfill({ status: 409, json: {} }))
  await open(page, 'Bread, spelt')
  await toggle(page).click()
  await history(page).getByRole('button', { name: 'Pin Version 2' }).click()
  await expect(history(page).getByRole('alert')).toContainText('Nothing moved')
  await expect(toast(page)).toHaveCount(0)
  await expect(version(page, 'Bread, spelt')).toContainText('In your collection')
  await expect(pins(page)).toHaveCount(1)
})

test('a version deleted from the history names what goes with it, and the page stays', async ({ page }) => {
  const rows = bread()
  const asked: string[] = []
  await mockApi(page, rows, (route, target, url) => {
    expect(route.request().method()).toBe('DELETE')
    asked.push(`${target}${url.search}`)
    if (url.searchParams.get('dryRun') !== 'true') rows.delete(target)
    return route.fulfill({ json: { deletion: { count: 1, ids: [target], pinned: id(4) } } })
  })
  await open(page, 'Bread, spelt')
  await toggle(page).click()
  await expect(history(page).locator('.history-version')).toHaveCount(4)
  await history(page).getByRole('button', { name: 'Delete Version 3' }).click()
  const question = page.getByRole('dialog', { name: 'Delete version 3?' })
  await expect(question).toContainText('gone for good')
  await question.getByRole('button', { name: 'Delete' }).click()
  await expect(toast(page)).toContainText('Version deleted')
  expect(asked).toEqual([`${id(3)}?dryRun=true`, id(3)])
  await expect(page).toHaveURL(`/recipes/${id(4)}`)
  await expect(history(page).locator('.history-version')).toHaveCount(3)
  await expect(history(page)).not.toContainText('Bread, rye')
})

test('deleting an earlier version with later ones counts them, from the same dry run as the page', async ({ page }) => {
  const rows = bread()
  await mockApi(page, rows, (route, target) =>
    route.fulfill({ json: { deletion: { count: 3, ids: [target, id(3), id(4)], pinned: id(1) } } }))
  await open(page, 'Bread, spelt')
  await toggle(page).click()
  await history(page).getByRole('button', { name: 'Delete Version 2' }).click()
  const question = page.getByRole('dialog', { name: 'Delete version 2 and 2 later versions?' })
  await expect(question).toContainText('every version that came after it')
  await expect(question.getByRole('button', { name: 'Keep it' })).toBeFocused()
  await question.getByRole('button', { name: 'Keep it' }).click()
  await history(page).getByRole('button', { name: 'Delete Original' }).click()
  await expect(page.getByRole('dialog', { name: 'Delete the original and 2 later versions?' })).toBeVisible()
})

test('a separate recipe knows where it came from, and says nothing when that is gone', async ({ page }) => {
  const rows = bread()
  await mockApi(page, rows)
  await open(page, 'Flatbread, charred')
  await toggle(page).click()
  const origin = history(page).locator('.history-origin')
  await expect(origin).toContainText('Started as a separate take on')
  await expect(origin.getByRole('link', { name: 'Bread' })).toHaveAttribute('href', `/recipes/${id(1)}`)
  // Its own two versions and nothing of Bread's.
  await expect(history(page).locator('.history-version')).toHaveCount(2)
  await expect(history(page)).not.toContainText('Bread, spelt')

  // The original deleted: variant_of is null, and the line still draws.
  await page.unrouteAll({ behavior: 'ignoreErrors' })
  const orphaned = new Map([...bread()].filter(([key]) => ![id(1), id(2), id(3), id(4)].includes(key)))
  orphaned.set(id(5), { ...orphaned.get(id(5))!, variantOf: null })
  await mockApi(page, orphaned)
  await open(page, 'Flatbread, charred')
  await toggle(page).click()
  await expect(history(page).locator('.history-version')).toHaveCount(2)
  await expect(history(page).locator('.history-origin')).toHaveCount(0)
})

test('a line of thirty is thirty rows at one depth, and one recipe read', async ({ page }) => {
  const rows = new Map<string, Row>()
  for (let n = 1; n <= 30; n++) {
    rows.set(id(n), row(n, `Stock ${n}`, { lineId: id(1), progressionOf: n === 1 ? null : id(n - 1), pinned: n === 30 }))
  }
  const reads = await mockApi(page, rows)
  await open(page, 'Stock 30')
  await toggle(page).click()
  await expect(history(page).locator('.history-version')).toHaveCount(30)
  // No forks, so no nesting: a single list.
  await expect(history(page).locator('.history-forks')).toHaveCount(0)
  await expect(history(page).locator('.history-chain')).toHaveCount(1)
  expect(reads.filter(read => read !== id(30))).toEqual([])
})
