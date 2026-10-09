import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validatePreferences } from '../server/utils/preferences.ts'
import { groupProblem, NO_PREFERENCES, PREFERENCE_KEYS, PREFERENCES, specsOf, type PreferenceGroup } from '../shared/utils/preferences.ts'

// A whole set of preferences from a request body (#62).
const status = (statusCode: number) => (error: unknown) => (error as { statusCode: number }).statusCode === statusCode

test('a set, or nothing set, comes back as given', () => {
  assert.deepEqual(validatePreferences({ unitSystem: 'imperial', portions: 4, paperNudge: null, ingredientMatching: null, ingredientBackfill: null, theme: null, grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null, stoveKind: null, stoveLowest: null, stoveHighest: null, stoveBoost: null, stoveMediumFrom: null, stoveHighFrom: null }), { unitSystem: 'imperial', portions: 4, paperNudge: null, ingredientMatching: null, ingredientBackfill: null, theme: null, grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null, stoveKind: null, stoveLowest: null, stoveHighest: null, stoveBoost: null, stoveMediumFrom: null, stoveHighFrom: null })
  assert.deepEqual(validatePreferences({ unitSystem: null, portions: null, paperNudge: null, ingredientMatching: null, ingredientBackfill: null, theme: null, grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null, stoveKind: null, stoveLowest: null, stoveHighest: null, stoveBoost: null, stoveMediumFrom: null, stoveHighFrom: null }), { unitSystem: null, portions: null, paperNudge: null, ingredientMatching: null, ingredientBackfill: null, theme: null, grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null, stoveKind: null, stoveLowest: null, stoveHighest: null, stoveBoost: null, stoveMediumFrom: null, stoveHighFrom: null })
  assert.deepEqual(validatePreferences({ unitSystem: null, portions: null, paperNudge: 'off', ingredientMatching: null, ingredientBackfill: null, theme: null, grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null, stoveKind: null, stoveLowest: null, stoveHighest: null, stoveBoost: null, stoveMediumFrom: null, stoveHighFrom: null }), { unitSystem: null, portions: null, paperNudge: 'off', ingredientMatching: null, ingredientBackfill: null, theme: null, grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null, stoveKind: null, stoveLowest: null, stoveHighest: null, stoveBoost: null, stoveMediumFrom: null, stoveHighFrom: null })
  assert.deepEqual(validatePreferences({ unitSystem: null, portions: null, paperNudge: null, ingredientMatching: null, ingredientBackfill: null, theme: 'crate-label', grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null, stoveKind: null, stoveLowest: null, stoveHighest: null, stoveBoost: null, stoveMediumFrom: null, stoveHighFrom: null }), { unitSystem: null, portions: null, paperNudge: null, ingredientMatching: null, ingredientBackfill: null, theme: 'crate-label', grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null, stoveKind: null, stoveLowest: null, stoveHighest: null, stoveBoost: null, stoveMediumFrom: null, stoveHighFrom: null })
})

test('anything else is a 400, a missing field included', () => {
  for (const body of [
    null, [], 'metric', {}, { unitSystem: 'metric' }, { portions: 2 },
    { unitSystem: 'Metric', portions: null, paperNudge: null, ingredientMatching: null, ingredientBackfill: null, theme: null, grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null, stoveKind: null, stoveLowest: null, stoveHighest: null, stoveBoost: null, stoveMediumFrom: null, stoveHighFrom: null }, { unitSystem: 'si', portions: null, paperNudge: null, ingredientMatching: null, ingredientBackfill: null, theme: null, grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null, stoveKind: null, stoveLowest: null, stoveHighest: null, stoveBoost: null, stoveMediumFrom: null, stoveHighFrom: null },
    { unitSystem: null, portions: 0, paperNudge: null, ingredientMatching: null, ingredientBackfill: null, theme: null, grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null, stoveKind: null, stoveLowest: null, stoveHighest: null, stoveBoost: null, stoveMediumFrom: null, stoveHighFrom: null }, { unitSystem: null, portions: 101, paperNudge: null, ingredientMatching: null, ingredientBackfill: null, theme: null, grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null, stoveKind: null, stoveLowest: null, stoveHighest: null, stoveBoost: null, stoveMediumFrom: null, stoveHighFrom: null }, { unitSystem: null, portions: 2.5, paperNudge: null, ingredientMatching: null, ingredientBackfill: null, theme: null, grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null, stoveKind: null, stoveLowest: null, stoveHighest: null, stoveBoost: null, stoveMediumFrom: null, stoveHighFrom: null },
    { unitSystem: null, portions: '4', paperNudge: null, ingredientMatching: null, ingredientBackfill: null, theme: null, grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null, stoveKind: null, stoveLowest: null, stoveHighest: null, stoveBoost: null, stoveMediumFrom: null, stoveHighFrom: null }, { unitSystem: null, portions: null, paperNudge: 'on', ingredientMatching: null, ingredientBackfill: null, theme: null, grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null, stoveKind: null, stoveLowest: null, stoveHighest: null, stoveBoost: null, stoveMediumFrom: null, stoveHighFrom: null },
    { unitSystem: null, portions: null, paperNudge: null, ingredientMatching: null, ingredientBackfill: null, theme: 'midnight', grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null, stoveKind: null, stoveLowest: null, stoveHighest: null, stoveBoost: null, stoveMediumFrom: null, stoveHighFrom: null },
    { unitSystem: null, portions: null }, { unitSystem: null, portions: Number.NaN, paperNudge: null, ingredientMatching: null, ingredientBackfill: null, theme: null, grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null, stoveKind: null, stoveLowest: null, stoveHighest: null, stoveBoost: null, stoveMediumFrom: null, stoveHighFrom: null },
    { unitSystem: null, portions: null, paperNudge: null, ingredientMatching: null, ingredientBackfill: null, theme: null, grainEffect: 'on', stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null, stoveKind: null, stoveLowest: null, stoveHighest: null, stoveBoost: null, stoveMediumFrom: null, stoveHighFrom: null },
    // A key the config does not have.
    { unitSystem: null, portions: null, paperNudge: null, ingredientMatching: null, ingredientBackfill: null, theme: null, stove: 'gas' },
  ])
    assert.throws(() => validatePreferences(body), status(400), JSON.stringify(body))
})

// Groups (#200): keys declared together, stored flat, checked across.
const range = {
  kind: 'group',
  label: 'Range',
  description: 'Lowest and highest.',
  keys: {
    lowest: { kind: 'number', label: 'Lowest', description: '', unset: '', min: 0, max: 20 },
    highest: { kind: 'number', label: 'Highest', description: '', unset: '', min: 0, max: 20 },
  },
  check: ({ lowest, highest }) =>
    typeof lowest === 'number' && typeof highest === 'number' && lowest >= highest ? 'The lowest setting must be below the highest.' : null,
} satisfies PreferenceGroup
const config = { portions: PREFERENCES.portions, range }

test('a group\'s keys sit beside the rest, flat', () => {
  assert.deepEqual(Object.keys(specsOf(config)), ['portions', 'lowest', 'highest'])
  assert.equal(specsOf(config).lowest, range.keys.lowest)
  assert.deepEqual(Object.keys(specsOf(PREFERENCES)), PREFERENCE_KEYS)
})

test('a name two keys share is refused', () => {
  assert.throws(() => specsOf({ portions: PREFERENCES.portions, range: { ...range, keys: { portions: range.keys.lowest } } }), /portions/)
})

test('a group\'s check answers what is wrong with the set', () => {
  assert.equal(groupProblem({ portions: null, lowest: 1, highest: 9 }, config), null)
  assert.equal(groupProblem({ portions: null, lowest: null, highest: 9 }, config), null)
  assert.equal(groupProblem({ portions: null, lowest: 9, highest: 9 }, config), 'The lowest setting must be below the highest.')
  assert.equal(groupProblem({ portions: null, lowest: 12, highest: 9 }, config), 'The lowest setting must be below the highest.')
})

// The stove (#108): a group of its own, checked across its keys by the route.
const stove = (keys: Record<string, unknown>) => ({ ...NO_PREFERENCES, ...keys })

test('a stove is kept, whole or a key at a time', () => {
  for (const keys of [
    { stoveKind: 'induction', stoveLowest: 1, stoveHighest: 9, stoveBoost: 'yes', stoveMediumFrom: 4, stoveHighFrom: 7 },
    { stoveKind: 'coil', stoveLowest: 1, stoveHighest: 6 },
    { stoveKind: 'ceramic', stoveLowest: 0, stoveHighest: 12, stoveHighFrom: 12 },
    { stoveKind: 'gas' },
    { stoveLowest: 1, stoveHighest: 3, stoveMediumFrom: 2, stoveHighFrom: 3 },
    { stoveMediumFrom: 4 }, { stoveHighest: 9, stoveHighFrom: 9 },
  ])
    assert.deepEqual(validatePreferences(stove(keys)), stove(keys), JSON.stringify(keys))
})

test('a stove that cannot hold three areas, or cut out of order, is a 400', () => {
  for (const keys of [
    { stoveLowest: 9, stoveHighest: 1 }, { stoveLowest: 5, stoveHighest: 5 }, { stoveLowest: 1, stoveHighest: 2 },
    { stoveLowest: 4, stoveMediumFrom: 4 }, { stoveMediumFrom: 7, stoveHighFrom: 7 }, { stoveMediumFrom: 8, stoveHighFrom: 6 },
    { stoveHighest: 9, stoveHighFrom: 10 }, { stoveHighest: 9, stoveMediumFrom: 9 }, { stoveLowest: 3, stoveHighFrom: 2 },
    { stoveKind: 'wood' }, { stoveLowest: 1.5 }, { stoveHighest: 21 }, { stoveBoost: 'P' },
  ])
    assert.throws(() => validatePreferences(stove(keys)), status(400), JSON.stringify(keys))
})
