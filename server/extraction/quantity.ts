import type { Quantity, QuantityKind, Unit } from './recipe.ts'

const FRACTIONS: Record<string, number> = {
  '½': 1 / 2, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 1 / 4, '¾': 3 / 4,
  '⅕': 1 / 5, '⅖': 2 / 5, '⅗': 3 / 5, '⅘': 4 / 5,
  '⅙': 1 / 6, '⅚': 5 / 6, '⅛': 1 / 8, '⅜': 3 / 8, '⅝': 5 / 8, '⅞': 7 / 8,
}

const FRACTION_CHARS = Object.keys(FRACTIONS).join('')

// Regional cup and spoon sizes cannot be recovered from the line itself, so the
// ambiguous unit is kept and resolved against source_lang at display time.
const UNITS: Record<string, [Unit, QuantityKind]> = {
  g: ['g', 'mass'], gram: ['g', 'mass'], grams: ['g', 'mass'], gramm: ['g', 'mass'], gramme: ['g', 'mass'],
  kg: ['kg', 'mass'], kilo: ['kg', 'mass'], kilogram: ['kg', 'mass'], kilograms: ['kg', 'mass'],
  mg: ['mg', 'mass'], milligram: ['mg', 'mass'], milligrams: ['mg', 'mass'],
  oz: ['oz', 'mass'], ounce: ['oz', 'mass'], ounces: ['oz', 'mass'],
  lb: ['lb', 'mass'], lbs: ['lb', 'mass'], pound: ['lb', 'mass'], pounds: ['lb', 'mass'],

  ml: ['ml', 'volume'], milliliter: ['ml', 'volume'], milliliters: ['ml', 'volume'], millilitre: ['ml', 'volume'],
  l: ['l', 'volume'], liter: ['l', 'volume'], liters: ['l', 'volume'], litre: ['l', 'volume'], litres: ['l', 'volume'],
  cup: ['cup', 'volume'], cups: ['cup', 'volume'],
  tbsp: ['tbsp', 'volume'], tablespoon: ['tbsp', 'volume'], tablespoons: ['tbsp', 'volume'],
  tsp: ['tsp', 'volume'], teaspoon: ['tsp', 'volume'], teaspoons: ['tsp', 'volume'],
  'fl oz': ['fl_oz', 'volume'], 'fluid ounce': ['fl_oz', 'volume'], 'fluid ounces': ['fl_oz', 'volume'],

  celsius: ['celsius', 'temperature'], centigrade: ['celsius', 'temperature'],
  fahrenheit: ['fahrenheit', 'temperature'],

  s: ['second', 'duration'], sec: ['second', 'duration'], secs: ['second', 'duration'],
  second: ['second', 'duration'], seconds: ['second', 'duration'],
  min: ['minute', 'duration'], mins: ['minute', 'duration'], minute: ['minute', 'duration'], minutes: ['minute', 'duration'],
  h: ['hour', 'duration'], hr: ['hour', 'duration'], hrs: ['hour', 'duration'], hour: ['hour', 'duration'], hours: ['hour', 'duration'],

  // "in" is left out on purpose: in prose it is a preposition far more often
  // than an inch, and "2 in the pan" must not become a length.
  mm: ['mm', 'length'], cm: ['cm', 'length'], inch: ['inch', 'length'], inches: ['inch', 'length'],
}

// "c" is cups in an ingredient list and Celsius in an oven instruction. No
// recipe calls for 90 cups and no oven runs below 90 degrees, so the value
// decides. A written degree sign settles it outright.
const AMBIGUOUS: Record<string, [hot: Unit, cold: Unit | null]> = {
  c: ['celsius', 'cup'],
  f: ['fahrenheit', null],
}
const TEMPERATURE_FLOOR = 90

const KINDS = new Map<Unit, QuantityKind>(Object.values(UNITS).map(([unit, kind]) => [unit, kind]))

// Longest forms first, so "1 1/2" is not read as a bare "1".
const NUMBER_PATTERN = [
  String.raw`\d+(?:[.,]\d+)?\s*\d+\s*/\s*\d+`,
  String.raw`\d+\s*/\s*\d+`,
  String.raw`\d+(?:[.,]\d+)?\s*[${FRACTION_CHARS}]`,
  String.raw`\d+(?:[.,]\d+)?`,
  String.raw`[${FRACTION_CHARS}]`,
].join('|')

const RANGE = /^\s*(?:-|–|—|to|through|bis)\s*/i

const key = (text: string) => text.toLowerCase().replace(/[.°]/g, '').replace(/\s+/g, ' ').trim()

export const unitInfo = (text: string): [Unit, QuantityKind] | null => UNITS[key(text)] ?? null

// Derived, never stored: kind is a pure function of the unit.
export const kindOf = (unit: Unit | null): QuantityKind => unit ? (KINDS.get(unit) ?? 'other') : 'count'

// Every unit parseQuantity can produce, and nothing else — which is exactly
// what a source that parsed an amount itself is allowed to send. The regional
// variants are deliberately absent: they are resolved for display, and one
// arriving here would never compare equal to the same amount read out of a
// step, which is how an ingredient stops rescaling with the step that uses it.
const PRODUCED = new Set<Unit>([...KINDS.keys(), 'count'])

export const isUnit = (value: unknown): value is Unit =>
  typeof value === 'string' && PRODUCED.has(value as Unit)

function resolveUnit(text: string, value: number): Unit | null {
  const ambiguous = AMBIGUOUS[key(text)]
  if (ambiguous && !text.includes('°')) return value >= TEMPERATURE_FLOOR ? ambiguous[0] : ambiguous[1]
  return unitInfo(text)?.[0] ?? null
}

function readNumber(input: string): { value: number, rest: string } | null {
  let rest = input.replace(/^\s+/, '')
  let value: number | null = null
  const whole = /^\d+(?:[.,]\d+)?/.exec(rest)

  if (whole) {
    // In "1/2" the leading digits are a numerator, not a whole number.
    const solo = /^(\d+)\s*\/\s*(\d+)/.exec(rest)
    if (solo) {
      value = Number(solo[1]) / Number(solo[2])
      rest = rest.slice(solo[0].length)
    } else {
      value = Number(whole[0].replace(',', '.'))
      rest = rest.slice(whole[0].length)
      const mixed = /^\s*(\d+)\s*\/\s*(\d+)/.exec(rest)
      const glyph = new RegExp(`^\\s*([${FRACTION_CHARS}])`).exec(rest)
      if (mixed) {
        value += Number(mixed[1]) / Number(mixed[2])
        rest = rest.slice(mixed[0].length)
      } else if (glyph) {
        value += FRACTIONS[glyph[1]!]!
        rest = rest.slice(glyph[0].length)
      }
    }
  } else {
    const glyph = new RegExp(`^([${FRACTION_CHARS}])`).exec(rest)
    if (glyph) {
      value = FRACTIONS[glyph[1]!]!
      rest = rest.slice(glyph[0].length)
    }
  }

  if (value === null || !Number.isFinite(value)) return null
  return { value, rest }
}

/**
 * Turns a quantity substring the model segmented out ("1½ cups", "2-3") into a
 * Quantity. Returns null when there is no number at all, as in "a pinch".
 */
export function parseQuantity(raw: string | null): Quantity | null {
  if (!raw) return null
  const first = readNumber(raw)
  if (!first) return null

  let maxValue: number | null = null
  let rest = first.rest
  const range = RANGE.exec(rest)
  if (range) {
    const second = readNumber(rest.slice(range[0].length))
    if (second) {
      maxValue = second.value
      rest = second.rest
    }
  }

  const trailing = rest.trim()
  // A bare number counts things. An unrecognised word is reported as no unit
  // rather than guessed at, and originalText still carries the wording.
  return { value: first.value, maxValue, unit: trailing ? resolveUnit(trailing, first.value) : 'count' }
}

// A number, an optional range, and an optional unit — for finding measurements
// in prose. Built fresh per call: a shared global regex would carry lastIndex
// between steps.
export const measurementPattern = () => new RegExp(
  `(?:${NUMBER_PATTERN})(?:\\s*(?:-|–|—|to|through)\\s*(?:${NUMBER_PATTERN}))?\\s*(?:°\\s*[cf]\\b|°|[a-zA-Z]+\\b)?`,
  'gi',
)
