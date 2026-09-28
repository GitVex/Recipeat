import type { Quantity, StepQuantity, Unit } from '../types/recipe.ts'

// How much a recipe makes, changed for reading: "for 6 instead of 4", or "I
// have 350 g of flour, not 500 g". Both come down to one factor applied to
// every amount that grows with the recipe. Nothing here touches the stored
// recipe; a scale is a way of looking at it.

export type Scale = {
  factor: number
  // What the factor was set from: 'portions', an ingredient's id, or nothing.
  anchor: string | null
  // The amount typed for an anchoring ingredient, in the units it was shown
  // in, so that line reads exactly as typed rather than as rounded.
  value: number | null
}

export const UNSCALED: Scale = { factor: 1, anchor: null, value: null }

// ── Rounding ───────────────────────────────────────────────────────────────

// The fractions each is measured in: a set of cups has thirds, spoons go down
// to an eighth, a scale or a ruler reads in quarters, and things are counted
// in halves at most — half an onion, never a third of an egg.
const CUP = [0, 1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4, 1]
const SPOON = [0, 1 / 8, 1 / 4, 1 / 2, 3 / 4, 1]
const QUARTERS = [0, 1 / 4, 1 / 2, 3 / 4, 1]
const HALVES = [0, 1 / 2, 1]

const CUPS = new Set<Unit>(['cup', 'cup_us', 'cup_metric'])
const SPOONS = new Set<Unit>(['tbsp', 'tbsp_us', 'tbsp_metric', 'tbsp_au', 'tsp', 'tsp_us', 'tsp_metric'])
const METRIC = new Set<Unit>(['g', 'kg', 'mg', 'ml', 'l', 'mm', 'cm'])

/** A value in the fractions its unit is measured in. */
export function kitchen(value: number, unit: Unit | null): number {
  const fractions = unit && CUPS.has(unit) ? CUP
    : unit && SPOONS.has(unit) ? SPOON
      : !unit || unit === 'count' ? HALVES
        : QUARTERS
  if (value >= 10) return Math.round(value)
  const whole = Math.floor(value)
  const rest = value - whole
  const nearest = fractions.reduce((best, fraction) => Math.abs(fraction - rest) < Math.abs(best - rest) ? fraction : best)
  // Never round an amount away to nothing.
  return whole + nearest || fractions[1]!
}

/** A metric value to what a scale or a jug shows: 250 g, not 247.5 g. */
export function metric(value: number, unit: Unit): number {
  if (unit === 'kg' || unit === 'l') return Math.round(value * 20) / 20 || 0.05
  if (value >= 100) return Math.round(value / 5) * 5
  if (value >= 10) return Math.round(value)
  return Math.round(value * 10) / 10 || 0.1
}

export const roundAmount = (value: number, unit: Unit | null) =>
  unit && METRIC.has(unit) ? metric(value, unit) : kitchen(value, unit)

// ── Scaling ────────────────────────────────────────────────────────────────

// Amounts that describe how to cook rather than how much: an oven, a timer,
// the size to cut something to. More food does not change them.
const FIXED = new Set<Unit>(['celsius', 'fahrenheit', 'second', 'minute', 'hour', 'mm', 'cm', 'inch'])

/** Whether an amount grows with the recipe. */
export const scalesWithRecipe = (quantity: Quantity) => !quantity.unit || !FIXED.has(quantity.unit)

/**
 * An amount times the factor, rounded to something a person can measure;
 * both ends of a range. `exact` skips the rounding, for the line the reader
 * set themselves.
 */
export function scaleQuantity(quantity: Quantity, factor: number, exact = false): Quantity {
  if (factor === 1 || !scalesWithRecipe(quantity)) return quantity
  const { unit, by } = regrouped(quantity.unit, (quantity.maxValue ?? quantity.value) * factor)
  const round = (value: number) => exact ? Math.round(value * 100) / 100 : roundAmount(value, unit)
  return {
    value: round(quantity.value * factor * by),
    maxValue: quantity.maxValue === null ? null : round(quantity.maxValue * factor * by),
    unit,
  }
}

// Scaled across a step between units, an amount moves into the next one:
// 1 kg, not 1,000 g; 400 g, not 0.4 kg. Chosen from the largest value, so
// both ends of a range agree. Cups and spoons stay as the source measured
// them — "12 tbsp butter" is how butter is measured.
const STEPS: Partial<Record<Unit, [small: Unit, large: Unit, ratio: number]>> = {
  mg: ['mg', 'g', 1000], g: ['g', 'kg', 1000], kg: ['g', 'kg', 1000],
  ml: ['ml', 'l', 1000], l: ['ml', 'l', 1000],
  oz: ['oz', 'lb', 16], lb: ['oz', 'lb', 16],
}

function regrouped(unit: Unit | null, largest: number): { unit: Unit | null, by: number } {
  const step = unit ? STEPS[unit] : undefined
  if (!unit || !step) return { unit, by: 1 }
  const [small, large, ratio] = step
  if (unit === small && largest >= ratio) return { unit: large, by: 1 / ratio }
  if (unit === large && largest < 1) return { unit: small, by: ratio }
  return { unit, by: 1 }
}

/**
 * What scaling does to an amount a step states itself. The normalizer decided
 * per amount: a weight scales, an oven temperature does not, and something it
 * could not place is left as it is and said to be.
 */
export const stepScaling = (quantity: StepQuantity): 'scales' | 'fixed' | 'unknown' =>
  quantity.scaleWithPortions === true ? 'scales' : quantity.scaleWithPortions === false ? 'fixed' : 'unknown'

/** Servings after scaling, to two places: 4 × 1.5 is 6, not 6.000000001. */
export const scaledPortions = (portions: number, factor: number) => Math.round(portions * factor * 100) / 100

/** "×1.5", for a recipe that does not say how many it serves. */
export const formatFactor = (factor: number) =>
  `×${new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(factor)}`

/** The next whole number of servings up or down from where it stands: 4.5 goes to 5 or 4. */
export function stepPortions(current: number, by: 1 | -1): number {
  const next = by > 0 ? Math.floor(current) + 1 : Math.ceil(current) - 1
  return Math.max(1, next)
}
