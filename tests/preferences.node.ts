import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validatePreferences } from '../server/utils/preferences.ts'

// A whole set of preferences from a request body (#62).
const status = (statusCode: number) => (error: unknown) => (error as { statusCode: number }).statusCode === statusCode

test('a set, or nothing set, comes back as given', () => {
  assert.deepEqual(validatePreferences({ unitSystem: 'imperial', portions: 4 }), { unitSystem: 'imperial', portions: 4 })
  assert.deepEqual(validatePreferences({ unitSystem: null, portions: null }), { unitSystem: null, portions: null })
})

test('anything else is a 400, a missing field included', () => {
  for (const body of [
    null, [], 'metric', {}, { unitSystem: 'metric' }, { portions: 2 },
    { unitSystem: 'Metric', portions: null }, { unitSystem: 'si', portions: null },
    { unitSystem: null, portions: 0 }, { unitSystem: null, portions: 101 }, { unitSystem: null, portions: 2.5 },
    { unitSystem: null, portions: '4' }, { unitSystem: null, portions: Number.NaN },
    // A key the config does not have.
    { unitSystem: null, portions: null, stove: 'gas' },
  ])
    assert.throws(() => validatePreferences(body), status(400), JSON.stringify(body))
})
