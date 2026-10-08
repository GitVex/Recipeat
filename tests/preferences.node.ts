import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validatePreferences } from '../server/utils/preferences.ts'

// A whole set of preferences from a request body (#62).
const status = (statusCode: number) => (error: unknown) => (error as { statusCode: number }).statusCode === statusCode

test('a set, or nothing set, comes back as given', () => {
  assert.deepEqual(validatePreferences({ unitSystem: 'imperial', portions: 4, paperNudge: null, ingredientMatching: null, ingredientBackfill: null, theme: null, grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null }), { unitSystem: 'imperial', portions: 4, paperNudge: null, ingredientMatching: null, ingredientBackfill: null, theme: null, grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null })
  assert.deepEqual(validatePreferences({ unitSystem: null, portions: null, paperNudge: null, ingredientMatching: null, ingredientBackfill: null, theme: null, grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null }), { unitSystem: null, portions: null, paperNudge: null, ingredientMatching: null, ingredientBackfill: null, theme: null, grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null })
  assert.deepEqual(validatePreferences({ unitSystem: null, portions: null, paperNudge: 'off', ingredientMatching: null, ingredientBackfill: null, theme: null, grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null }), { unitSystem: null, portions: null, paperNudge: 'off', ingredientMatching: null, ingredientBackfill: null, theme: null, grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null })
  assert.deepEqual(validatePreferences({ unitSystem: null, portions: null, paperNudge: null, ingredientMatching: null, ingredientBackfill: null, theme: 'crate-label', grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null }), { unitSystem: null, portions: null, paperNudge: null, ingredientMatching: null, ingredientBackfill: null, theme: 'crate-label', grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null })
})

test('anything else is a 400, a missing field included', () => {
  for (const body of [
    null, [], 'metric', {}, { unitSystem: 'metric' }, { portions: 2 },
    { unitSystem: 'Metric', portions: null, paperNudge: null, ingredientMatching: null, ingredientBackfill: null, theme: null, grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null }, { unitSystem: 'si', portions: null, paperNudge: null, ingredientMatching: null, ingredientBackfill: null, theme: null, grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null },
    { unitSystem: null, portions: 0, paperNudge: null, ingredientMatching: null, ingredientBackfill: null, theme: null, grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null }, { unitSystem: null, portions: 101, paperNudge: null, ingredientMatching: null, ingredientBackfill: null, theme: null, grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null }, { unitSystem: null, portions: 2.5, paperNudge: null, ingredientMatching: null, ingredientBackfill: null, theme: null, grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null },
    { unitSystem: null, portions: '4', paperNudge: null, ingredientMatching: null, ingredientBackfill: null, theme: null, grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null }, { unitSystem: null, portions: null, paperNudge: 'on', ingredientMatching: null, ingredientBackfill: null, theme: null, grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null },
    { unitSystem: null, portions: null, paperNudge: null, ingredientMatching: null, ingredientBackfill: null, theme: 'midnight', grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null },
    { unitSystem: null, portions: null }, { unitSystem: null, portions: Number.NaN, paperNudge: null, ingredientMatching: null, ingredientBackfill: null, theme: null, grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null },
    { unitSystem: null, portions: null, paperNudge: null, ingredientMatching: null, ingredientBackfill: null, theme: null, grainEffect: 'on', stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null },
    // A key the config does not have.
    { unitSystem: null, portions: null, paperNudge: null, ingredientMatching: null, ingredientBackfill: null, theme: null, stove: 'gas' },
  ])
    assert.throws(() => validatePreferences(body), status(400), JSON.stringify(body))
})
