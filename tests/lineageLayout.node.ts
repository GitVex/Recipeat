import assert from 'node:assert/strict'
import { test } from 'node:test'
import { layoutLineage, nodeKey, type PlacedNode } from '../app/utils/lineageLayout.ts'
import type { HistoryTree } from '../app/utils/recipeHistory.ts'
import type { RecipeBranch, RecipeHistory, RecipeVersion } from '../shared/types/recipe.ts'

// Where the lineage page puts each node (#31, #88): time runs down this line,
// and what leaves it goes sideways.
const version = (id: string, progressionOf: string | null = null): RecipeVersion => ({
  id, title: id, progressionOf, pinned: false, ingredientCount: 1, stepCount: 1,
  createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', changes: null,
})
const branch = (id: string, variantOf: string): RecipeBranch => ({ id, title: id, createdAt: '2026-09-01T00:00:00.000Z', variantOf })

// A line from its versions and branches, the way historyTree builds one.
function line(versions: RecipeVersion[], variants: RecipeBranch[] = [], origin: RecipeHistory['origin'] = null) {
  const history: RecipeHistory = { lineId: versions[0]!.id, versions, variants, origin }
  const children = new Map<string, RecipeVersion[]>()
  for (const v of versions) if (v.progressionOf) children.set(v.progressionOf, [...(children.get(v.progressionOf) ?? []), v])
  const branches = new Map<string, RecipeBranch[]>()
  for (const b of variants) branches.set(b.variantOf, [...(branches.get(b.variantOf) ?? []), b])
  const tree = { root: versions[0]!, children, variants: branches, label: () => '' } as unknown as HistoryTree
  return layoutLineage(history, tree)
}
const at = (nodes: PlacedNode[], kind: PlacedNode['kind'], id: string) => {
  const node = nodes.find(n => n.kind === kind && n.id === id)
  assert.ok(node, `${kind} ${id} is placed`)
  return node
}
// No two nodes share a row closer than a node's width.
const apart = (nodes: PlacedNode[]) => {
  const rows = new Map<number, number[]>()
  for (const n of nodes) rows.set(n.depth, [...(rows.get(n.depth) ?? []), n.slot])
  for (const [depth, slots] of rows) {
    slots.sort((a, b) => a - b)
    for (let i = 1; i < slots.length; i++) assert.ok(slots[i]! - slots[i - 1]! >= 1, `row ${depth} overlaps at ${slots[i - 1]} and ${slots[i]}`)
  }
}

test('progressions run down, a fork side by side, and the version centred over it', () => {
  const { nodes, edges } = line([version('a'), version('b', 'a'), version('c', 'a'), version('d', 'b')])
  assert.equal(at(nodes, 'version', 'a').depth, 0)
  assert.equal(at(nodes, 'version', 'b').depth, 1)
  assert.equal(at(nodes, 'version', 'c').depth, 1)
  assert.equal(at(nodes, 'version', 'd').depth, 2)
  assert.equal(at(nodes, 'version', 'a').slot, (at(nodes, 'version', 'b').slot + at(nodes, 'version', 'c').slot) / 2)
  assert.ok(edges.every(edge => edge.direction === 'down'))
  apart(nodes)
})

test('a separate recipe stands on its version’s row, to its right, joined across', () => {
  const { nodes, edges } = line([version('a'), version('b', 'a')], [branch('x', 'a')])
  const a = at(nodes, 'version', 'a')
  const x = at(nodes, 'variant', 'x')
  assert.equal(x.depth, a.depth)
  assert.equal(x.slot, a.slot + 1)
  // The progression still goes down, under its version.
  assert.equal(at(nodes, 'version', 'b').depth, 1)
  assert.equal(at(nodes, 'version', 'b').slot, a.slot)
  assert.deepEqual(edges.find(edge => edge.id === 'v:x'), {
    id: 'v:x', source: nodeKey({ kind: 'version', id: 'a' }), target: nodeKey({ kind: 'variant', id: 'x' }), kind: 'variant', direction: 'across',
  })
})

test('several separate recipes of one version sit side by side, clear of the next branch over', () => {
  // a forks into b and c; b has two separate recipes, which take the row b and
  // c share, so c moves over to make room for them.
  const { nodes } = line(
    [version('a'), version('b', 'a'), version('c', 'a'), version('d', 'b'), version('e', 'c')],
    [branch('x', 'b'), branch('y', 'b')],
  )
  const b = at(nodes, 'version', 'b')
  assert.deepEqual([at(nodes, 'variant', 'x').slot, at(nodes, 'variant', 'y').slot], [b.slot + 1, b.slot + 2])
  assert.ok(at(nodes, 'version', 'c').slot >= b.slot + 3)
  // Below, where the separate recipes take no room, c's line keeps its place
  // under c rather than drifting back.
  assert.equal(at(nodes, 'version', 'e').slot, at(nodes, 'version', 'c').slot)
  apart(nodes)
})

test('a subtree packs under a neighbour’s separate recipes when their rows do not meet', () => {
  // b's separate recipe is on row 1; c's deep line is on rows 1 to 3. They
  // only meet on row 1, so c sits just past the separate recipe, no further.
  const { nodes } = line(
    [version('a'), version('b', 'a'), version('c', 'a'), version('d', 'c'), version('e', 'd')],
    [branch('x', 'b')],
  )
  assert.equal(at(nodes, 'version', 'c').slot, at(nodes, 'variant', 'x').slot + 1)
  apart(nodes)
})

test('the recipe a line branched off stands to the left of its original, on the same row', () => {
  const { nodes, edges } = line([version('a'), version('b', 'a')], [branch('x', 'a')], { id: 'o', title: 'Origin' })
  const origin = at(nodes, 'origin', 'o')
  const a = at(nodes, 'version', 'a')
  assert.equal(origin.depth, a.depth)
  assert.equal(origin.slot, a.slot - 1)
  assert.equal(Math.min(...nodes.map(n => n.slot)), 0)
  assert.equal(edges.find(edge => edge.id === 'o:o')!.direction, 'across')
  apart(nodes)
})
