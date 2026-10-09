import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { HeatLevel } from '../shared/types/recipe.ts'
import { heatSetting } from '../shared/utils/heat.ts'

// A heat level as a setting on the cook's stove (#54).
const LEVELS: HeatLevel[] = ['low', 'medium-low', 'medium', 'medium-high', 'high']
type Kind = 'induction' | 'ceramic' | 'coil' | 'gas' | null
const stove = (stoveKind: Kind, stoveLowest: number | null, stoveHighest: number | null, stoveMediumFrom: number | null = null, stoveHighFrom: number | null = null) =>
  ({ stoveKind, stoveLowest, stoveHighest, stoveMediumFrom, stoveHighFrom })
const all = (s: ReturnType<typeof stove>) => LEVELS.map(level => heatSetting(level, s))

test('the cook\'s cuts make five levels, a span where two settings, one number where one', () => {
  assert.deepEqual(all(stove('ceramic', 1, 9, 4, 7)), ['1–3', '3–4', '4–6', '6–7', '7–9'])
  assert.deepEqual(all(stove('induction', 1, 9, 2, 3)), ['1', '1–2', '2', '2–3', '3–9'])
})

test('until the cook moves them, the kind\'s defaults cut the range, induction lowest', () => {
  assert.deepEqual(all(stove('induction', 1, 9)), ['1–2', '2–3', '3–5', '5–6', '6–9'])
  assert.deepEqual(all(stove('ceramic', 1, 9)), ['1–3', '3–4', '4–6', '6–7', '7–9'])
  assert.deepEqual(all(stove('ceramic', 0, 12)), ['0–4', '4–5', '5–8', '8–9', '9–12'])
  assert.deepEqual(all(stove('coil', 1, 6)), ['1–2', '2–3', '3–4', '4–5', '5–6'])
})

test('one cut moved, the default beside it gets out of its way', () => {
  assert.deepEqual(all(stove('induction', 1, 9, 7)), ['1–6', '6–7', '7', '7–8', '8–9'])
  assert.deepEqual(all(stove('ceramic', 1, 9, null, 3)), ['1', '1–2', '2', '2–3', '3–9'])
  // No room for medium below a high that starts one past the lowest.
  assert.deepEqual(all(stove('ceramic', 1, 9, null, 2)), [null, null, null, null, null])
})

test('every level is a valid whole setting on every range a stove may have', () => {
  for (const kind of ['induction', 'ceramic', 'coil'] as const)
    for (let lowest = 0; lowest <= 18; lowest++)
      for (let highest = lowest + 2; highest <= 20; highest++)
        for (const level of LEVELS) {
          const shown = heatSetting(level, stove(kind, lowest, highest))
          assert.ok(shown, `${kind} ${lowest}–${highest} ${level}`)
          const [from, to = from] = shown.split('–').map(Number)
          for (const setting of [from!, to!]) assert.ok(Number.isInteger(setting) && setting >= lowest && setting <= highest, `${kind} ${lowest}–${highest} ${level}: ${shown}`)
          assert.ok(from! <= to!)
        }
  // The smallest: three settings, one for each area.
  assert.deepEqual(all(stove('coil', 1, 3)), ['1', '1–2', '2', '2–3', '3'])
})

test('gas, no stove, or a range too small says nothing rather than invent', () => {
  assert.deepEqual(all(stove('gas', 1, 9)), [null, null, null, null, null])
  assert.equal(heatSetting('medium', null), null)
  assert.equal(heatSetting('medium', stove(null, 1, 9)), null)
  assert.equal(heatSetting('medium', stove('induction', null, 9)), null)
  assert.equal(heatSetting('medium', stove('induction', 1, null)), null)
  assert.equal(heatSetting('medium', stove('induction', 1, 2)), null)
})
