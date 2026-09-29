import { test, expect, type Page, type Route } from '@playwright/test'

// A recipe's own history (#31), against a mocked API: the path to it on the
// recipe page, and the whole tree on the lineage page. The server's walk of a
// line is tests/database.live.ts's business; here a line is written by hand
// and the test checks what each page draws from it and what it asks for.
const id = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`

type Row = {
  id: string, title: string | null, tags: string[], lineId: string, progressionOf: string | null, variantOf: string | null,
  pinned: boolean, createdAt: string,
  // How the server would count it against the line's original.
  changes?: unknown,
}
const row = (n: number, title: string, extra: Partial<Row> = {}): Row => ({
  id: id(n), title, tags: [], lineId: id(n), progressionOf: null, variantOf: null, pinned: true,
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
    versions: line.map(r => ({
      id: r.id, title: r.title, progressionOf: r.progressionOf, pinned: r.pinned, ingredientCount: 1, stepCount: 1, createdAt: r.createdAt, updatedAt: r.createdAt,
      changes: r.id === lineId ? null : (r.changes ?? same),
    })),
    variants,
    origin: from && rows.has(from) ? { id: from, title: rows.get(from)!.title } : null,
  }
}

const count = { added: 0, removed: 0, changed: 0, items: [] }
const same = { title: false, portions: null, totalTime: null, ingredients: count, steps: count }

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
  await page.getByRole('navigation').getByRole('link', { name: /My recipes/ }).click()
  await page.locator('.collection-entry', { hasText: title }).click()
  await expect(page.locator('#open-recipe-title')).toContainText(title)
}
const history = (page: Page) => page.getByRole('region', { name: /History/ })
const toggle = (page: Page) => page.getByRole('button', { name: /^History/ })
const toast = (page: Page) => page.locator('.toast')
// A version's own row. Its list item holds everything made from it, too.
// Whole text only: "Original" is also inside every "Since the original".
const exactly = (text: string) => new RegExp(`^\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`)
const version = (page: Page, title: string) => history(page).locator('.history-row')
  .filter({ has: page.locator('.history-label, .history-title', { hasText: exactly(title) }) })
const pins = (page: Page) => history(page).locator('.history-tag.pinned')
// The lineage page's tree, and one node of it by its title.
const canvas = (page: Page) => page.locator('.lineage-canvas')
const node = (page: Page, title: string) => canvas(page).locator('.lineage-node').filter({ has: page.getByRole('link', { name: title, exact: true }) })
// Where each node sits on the canvas, by title, as Vue Flow placed it.
const positions = (page: Page) => canvas(page).locator('.vue-flow__node').evaluateAll(nodes => Object.fromEntries(nodes.map((node) => {
  const [, x, y] = (node as HTMLElement).style.transform.match(/translate\((-?[\d.]+)px, (-?[\d.]+)px\)/)!
  return [node.querySelector('.lineage-title')!.textContent!.trim(), { x: Number(x), y: Number(y) }]
})))
const openLineage = async (page: Page) => {
  await history(page).getByRole('link', { name: 'Open the full lineage' }).click()
  await expect(canvas(page).locator('.lineage-node').first()).toBeVisible()
}

// Bread: an original, a second version, and two made from the second — one
// of them pinned. A separate recipe branched off the original, and has moved
// on to a second version of its own.
function bread() {
  return new Map<string, Row>([
    [id(1), row(1, 'Bread', { pinned: false })],
    [id(2), row(2, 'Bread, wetter', { lineId: id(1), progressionOf: id(1), pinned: false })],
    [id(3), row(3, 'Bread, rye', { lineId: id(1), progressionOf: id(2), pinned: false })],
    [id(4), row(4, 'Bread, spelt', {
      lineId: id(1), progressionOf: id(2),
      changes: {
        ...same, title: true, portions: [2, 4],
        ingredients: {
          added: 1, removed: 0, changed: 1,
          items: [
            { kind: 'changed', name: 'flour', amount: { from: '500 g', to: '550 g', by: '+50 g' }, snippet: null },
            { kind: 'added', name: 'spelt', text: '100 g spelt' },
          ],
        },
        steps: {
          added: 0, removed: 0, changed: 1,
          items: [{ kind: 'changed', number: 2, snippet: { before: 'Knead for', removed: '10', added: '15', after: 'minutes.' } }],
        },
      },
    })],
    [id(5), row(5, 'Flatbread', { variantOf: id(1), pinned: false })],
    [id(6), row(6, 'Flatbread, charred', { lineId: id(5), progressionOf: id(5) })],
  ])
}

// Flatbread after Bread was deleted: its own line, with variant_of cleared.
function orphaned() {
  const rows = new Map([...bread()].filter(([key]) => ![id(1), id(2), id(3), id(4)].includes(key)))
  rows.set(id(5), { ...rows.get(id(5))!, variantOf: null })
  return rows
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

test('the recipe page shows the straight path from the original to it, and no more', async ({ page }) => {
  const reads = await mockApi(page, bread())
  await open(page, 'Bread, spelt')
  // Quiet until asked: the recipe on the page is the one the collection shows.
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false')
  await expect(toggle(page)).toContainText('4 versions, 1 separate recipe')
  await toggle(page).click()
  const panel = history(page)
  await expect(panel).toContainText('changing one never changes the versions made from it')

  // Original → Version 2 → Version 4. The other branch of the fork, and what
  // branched off as a separate recipe, are the lineage page's.
  const path = panel.getByRole('list', { name: 'From the original to this version' })
  await expect(path.locator('.history-label')).toHaveText(['Original', 'Version 2', 'Version 4'])
  await expect(panel).not.toContainText('Bread, rye')
  await expect(panel).not.toContainText('Flatbread')
  await expect(panel.locator('.history-more')).toContainText('The full lineage also has 1 other version and 1 separate recipe.')

  const spelt = version(page, 'Bread, spelt')
  // Each version says how it differs from the original; the original says
  // nothing, and a version that reads the same says so.
  await expect(spelt.locator('.history-changes')).toHaveText('Since the originalRenamed · +1 ingredient · 1 ingredient changed · 1 step changed · Serves 2 → 4')
  await expect(version(page, 'Bread, wetter').locator('.history-changes')).toContainText('Same as the original')
  await expect(version(page, 'Original').locator('.history-changes')).toHaveCount(0)
  await expect(spelt).toContainText('Open now')
  await expect(spelt).toContainText('In your recipes')
  await expect(pins(page)).toHaveCount(1)
  await expect(panel.getByRole('button', { name: /^Pin / })).toHaveCount(2)
  await expect(panel.getByRole('button', { name: /^Delete / })).toHaveCount(3)
  await expect(panel.getByRole('link', { name: 'Open the full lineage' })).toHaveAttribute('href', `/recipes/${id(4)}/lineage`)
  // Each version is its card; only the one on the page was read in full.
  expect(reads.filter(read => read !== id(4))).toEqual([])
  await page.screenshot({ path: 'test-results/history-path.png', fullPage: true })
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

  // Said before anything is changed, and the history is already open, down
  // to this version and no further.
  const note = page.getByRole('note')
  await expect(note).toContainText('An earlier version')
  await expect(note).toContainText('Changes saved here stay with this one')
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true')
  await expect(history(page).locator('.history-label')).toHaveText(['Original', 'Version 2'])
  await expect(history(page).locator('.history-more')).toContainText('2 other versions and 1 separate recipe')

  await note.getByRole('button', { name: 'Pin this version' }).click()
  await expect(toast(page)).toContainText('My recipes shows this version now')
  expect(pinned).toEqual([id(2)])
  await expect(page.getByRole('note')).toHaveCount(0)
  await expect(version(page, 'Bread, wetter')).toContainText('In your recipes')
  await expect(pins(page)).toHaveCount(1)
  // The collection's entry for the line is this version now.
  await expect(page.locator('.collection-entry', { hasText: 'Bread' }).first()).toHaveAttribute('href', `/recipes/${id(2)}`)
})

test('a version on the path can be pinned, not only the one on the page', async ({ page }) => {
  const rows = bread()
  await mockApi(page, rows, (route, target) => {
    for (const [key, r] of rows) if (r.lineId === id(1)) rows.set(key, { ...r, pinned: key === target })
    return route.fulfill({ json: { pinned: target, lineId: id(1) } })
  })
  await open(page, 'Bread, spelt')
  await toggle(page).click()
  await history(page).getByRole('button', { name: 'Pin Original' }).click()
  await expect(toast(page)).toContainText('My recipes shows this version now')
  // This page is the earlier one now, and says so.
  await expect(page.getByRole('note')).toContainText('An earlier version')
  await expect(version(page, 'Original')).toContainText('In your recipes')
  await expect(pins(page)).toHaveCount(1)
})

test('a pin that fails says so, and the pin stays where it was', async ({ page }) => {
  await mockApi(page, bread(), route => route.fulfill({ status: 409, json: {} }))
  await open(page, 'Bread, spelt')
  await toggle(page).click()
  await history(page).getByRole('button', { name: 'Pin Version 2' }).click()
  await expect(history(page).getByRole('alert')).toContainText('Nothing moved')
  await expect(toast(page)).toHaveCount(0)
  await expect(version(page, 'Bread, spelt')).toContainText('In your recipes')
  await expect(pins(page)).toHaveCount(1)
})

test('deleting a version on the path counts what goes with it, from the same dry run as the page', async ({ page }) => {
  await mockApi(page, bread(), (route, target) =>
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
  await mockApi(page, bread())
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
  await mockApi(page, orphaned())
  await open(page, 'Flatbread, charred')
  await toggle(page).click()
  await expect(history(page).locator('.history-version')).toHaveCount(2)
  await expect(history(page).locator('.history-origin')).toHaveCount(0)
})

test('a line of thirty is one path of thirty rows, and one recipe read', async ({ page }) => {
  const rows = new Map<string, Row>()
  for (let n = 1; n <= 30; n++) {
    rows.set(id(n), row(n, `Stock ${n}`, { lineId: id(1), progressionOf: n === 1 ? null : id(n - 1), pinned: n === 30 }))
  }
  const reads = await mockApi(page, rows)
  await open(page, 'Stock 30')
  await toggle(page).click()
  await expect(history(page).locator('.history-version')).toHaveCount(30)
  // Nothing beyond the path, so nothing said about it.
  await expect(history(page).locator('.history-more p')).toHaveCount(0)
  expect(reads.filter(read => read !== id(30))).toEqual([])
})

// ── The lineage page ────────────────────────────────────────────────────────

test('the lineage page draws the whole tree: both branches, the pin, and what branched off', async ({ page }) => {
  const reads = await mockApi(page, bread())
  await open(page, 'Bread, spelt')
  await toggle(page).click()
  await openLineage(page)
  await expect(page).toHaveURL(`/recipes/${id(4)}/lineage`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bread, spelt')

  // Four versions of the line and one separate recipe, by its entry point.
  await expect(canvas(page).locator('.lineage-node.version')).toHaveCount(4)
  await expect(canvas(page).locator('.lineage-node.variant')).toHaveCount(1)
  await expect(canvas(page).locator('.vue-flow__edge')).toHaveCount(4)
  await expect(canvas(page).locator('.lineage-edge.variant')).toHaveCount(1)
  await expect(node(page, 'Flatbread, charred')).toContainText('Separate recipe')
  await expect(node(page, 'Flatbread, charred').getByRole('link')).toHaveAttribute('href', `/recipes/${id(6)}`)
  await expect(canvas(page)).not.toContainText(/Flatbread(?!, charred)/)

  // Time runs down the page, and a fork's branches stand side by side in the
  // generation below the version they came from. A separate recipe leaves
  // the line, so it stands beside its version, on its row (#88). Positions
  // are read in one go: the view may still be fitting itself, and a zoom
  // between two reads would move one node and not the other.
  const at = await positions(page)
  expect(at['Bread, wetter']!.y).toBeGreaterThan(at['Bread']!.y)
  expect(at['Bread, rye']!.y).toBe(at['Bread, spelt']!.y)
  expect(at['Bread, rye']!.y).toBeGreaterThan(at['Bread, wetter']!.y)
  expect(at['Bread, rye']!.x).not.toBe(at['Bread, spelt']!.x)
  expect(at['Flatbread, charred']!.y).toBe(at['Bread']!.y)
  expect(at['Flatbread, charred']!.x).toBeGreaterThan(at['Bread']!.x)

  await expect(node(page, 'Bread, spelt')).toContainText('You came from here')
  await expect(node(page, 'Bread, spelt')).toContainText('In your recipes')
  await expect(canvas(page).locator('.history-tag.pinned')).toHaveCount(1)
  // Itemised: which ingredient and by how much, which step and what in it.
  const changes = node(page, 'Bread, spelt').locator('.lineage-changes')
  await expect(changes.locator('.change-headline')).toHaveText('Renamed · Serves 2 → 4')
  const ingredients = changes.getByRole('list', { name: 'Ingredients that changed' }).getByRole('listitem')
  await expect(ingredients).toHaveText([/flour\s*500 g\s*→\s*550 g\s*\+50 g/, /Added: 100 g spelt/])
  await expect(ingredients.first().locator('del')).toHaveText('500 g')
  await expect(ingredients.first().locator('ins')).toHaveText('550 g')
  const steps = changes.getByRole('list', { name: 'Steps that changed' }).getByRole('listitem')
  await expect(steps).toHaveText([/Step 2\s*Knead for 10 15 minutes\./])
  await expect(steps.first().locator('del')).toHaveText('10')
  await expect(steps.first().locator('ins')).toHaveText('15')
  // Wetter reads the same as the original, and says so.
  await expect(node(page, 'Bread, wetter').locator('.change-headline')).toHaveText('Same as the original')
  // Grown downwards, and still clear of the generation below.
  const boxes = await canvas(page).locator('.lineage-node').evaluateAll(nodes => Object.fromEntries(nodes.map((node) => {
    const box = node.getBoundingClientRect()
    return [node.querySelector('.lineage-title')!.textContent!.trim(), { top: box.top, bottom: box.bottom }]
  })))
  expect(boxes['Bread']!.bottom).toBeLessThan(boxes['Bread, wetter']!.top)
  expect(boxes['Bread, wetter']!.bottom).toBeLessThan(boxes['Bread, spelt']!.top)
  await expect(node(page, 'Bread').locator('.lineage-changes')).toHaveCount(0)
  // A separate recipe is its own line, and is not counted against this one.
  await expect(node(page, 'Flatbread, charred').locator('.lineage-changes')).toHaveCount(0)
  await expect(canvas(page).getByRole('button', { name: /^Pin / })).toHaveCount(3)
  await expect(canvas(page).getByRole('button', { name: /^Delete / })).toHaveCount(4)
  expect(reads.filter(read => read !== id(4))).toEqual([])
  await page.screenshot({ path: 'test-results/lineage.png', fullPage: true })

  // A version is reached by its node.
  await node(page, 'Bread, rye').getByRole('link').click()
  await expect(page).toHaveURL(`/recipes/${id(3)}`)
  await expect(page.locator('#open-recipe-title')).toContainText('Bread, rye')
})

test('any version can be pinned from the lineage page', async ({ page }) => {
  const rows = bread()
  await mockApi(page, rows, (route, target) => {
    for (const [key, r] of rows) if (r.lineId === id(1)) rows.set(key, { ...r, pinned: key === target })
    return route.fulfill({ json: { pinned: target, lineId: id(1) } })
  })
  await open(page, 'Bread, spelt')
  await toggle(page).click()
  await openLineage(page)
  await node(page, 'Bread, rye').getByRole('button', { name: 'Pin Version 3' }).click()
  await expect(toast(page)).toContainText('My recipes shows this version now')
  await expect(node(page, 'Bread, rye')).toContainText('In your recipes')
  await expect(canvas(page).locator('.history-tag.pinned')).toHaveCount(1)
})

test('a version deleted from the lineage page goes, and the tree is drawn again', async ({ page }) => {
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
  await openLineage(page)
  await node(page, 'Bread, rye').getByRole('button', { name: 'Delete Version 3' }).click()
  const question = page.getByRole('dialog', { name: 'Delete version 3?' })
  await expect(question).toContainText('gone for good')
  await question.getByRole('button', { name: 'Delete' }).click()
  await expect(toast(page)).toContainText('Version deleted')
  expect(asked).toEqual([`${id(3)}?dryRun=true`, id(3)])
  await expect(page).toHaveURL(`/recipes/${id(4)}/lineage`)
  await expect(canvas(page).locator('.lineage-node.version')).toHaveCount(3)
  await expect(canvas(page)).not.toContainText('Bread, rye')
})

test('deleting the version the lineage page came from moves to what is left of the line', async ({ page }) => {
  const rows = bread()
  await mockApi(page, rows, (route, target, url) => {
    if (url.searchParams.get('dryRun') !== 'true') {
      rows.delete(target)
      rows.set(id(2), { ...rows.get(id(2))!, pinned: true })
    }
    return route.fulfill({ json: { deletion: { count: 1, ids: [target], pinned: id(2) } } })
  })
  await open(page, 'Bread, spelt')
  await toggle(page).click()
  await openLineage(page)
  await node(page, 'Bread, spelt').getByRole('button', { name: 'Delete Version 4' }).click()
  await page.getByRole('dialog', { name: 'Delete version 4?' }).getByRole('button', { name: 'Delete' }).click()
  await expect(page).toHaveURL(`/recipes/${id(2)}/lineage`)
  await expect(node(page, 'Bread, wetter')).toContainText('You came from here')
  await expect(node(page, 'Bread, wetter')).toContainText('In your recipes')
})

test('a separate recipe’s lineage starts from where it came from, and without it when that is gone', async ({ page }) => {
  await mockApi(page, bread())
  await open(page, 'Flatbread, charred')
  await toggle(page).click()
  await openLineage(page)
  const origin = canvas(page).locator('.lineage-node.origin')
  await expect(origin).toContainText('Branched off')
  await expect(origin.getByRole('link', { name: 'Bread' })).toHaveAttribute('href', `/recipes/${id(1)}`)
  // Its own two versions; nothing else of Bread's line.
  await expect(canvas(page).locator('.lineage-node.version')).toHaveCount(2)
  await expect(canvas(page)).not.toContainText('Bread, spelt')

  await page.unrouteAll({ behavior: 'ignoreErrors' })
  await mockApi(page, orphaned())
  await open(page, 'Flatbread, charred')
  await toggle(page).click()
  await openLineage(page)
  await expect(canvas(page).locator('.lineage-node.version')).toHaveCount(2)
  await expect(canvas(page).locator('.lineage-node.origin')).toHaveCount(0)
})

test('signed out, the lineage page says so', async ({ page }) => {
  await page.goto(`/recipes/${id(1)}/lineage`)
  await expect(page.getByRole('heading', { name: 'Sign in to see this recipe’s lineage.' })).toBeVisible()
  await expect(canvas(page)).toHaveCount(0)
})
