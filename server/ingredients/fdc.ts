import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Sql } from 'postgres'

// USDA FoodData Central (#147), SR Legacy and Foundation Foods: the foods a
// learned key is looked up in, and the household portions a density is read
// from. Public domain (CC0); USDA asks to be named as the source, which
// docs/extraction.md does. Branded Foods is left out: large and noisy.

const DATA_TYPES = new Set(['sr_legacy_food', 'foundation_food'])

// FDC measures in US cups and spoons.
const ML: Record<string, number> = { cup: 236.588, tbsp: 14.7868, tsp: 4.92892, 'fl oz': 29.5735 }
const VOLUME = /^(cups?|tbsp|tablespoons?|tsp|teaspoons?|fl oz)\b/i
const unitOf = (text: string) => {
  const word = VOLUME.exec(text)?.[1]!.toLowerCase()
  if (!word) return null
  return word.startsWith('cup') ? 'cup' : word.startsWith('tb') || word.startsWith('table') ? 'tbsp' : word === 'fl oz' ? 'fl oz' : 'tsp'
}

function csv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], field = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (quoted) {
      if (c !== '"') field += c
      else if (text[i + 1] === '"') { field += '"'; i++ }
      else quoted = false
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c !== '\r') field += c
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  return rows.slice(1)
}

type Food = { fdc_id: number, data_type: string, description: string }
type Portion = { fdc_id: number, amount: number, unit: string, modifier: string, grams: number }

// One unzipped CSV download: its foods, and their cup and spoon portions.
function read(dir: string): { foods: Food[], portions: Portion[] } {
  const file = (name: string) => csv(readFileSync(join(dir, name), 'utf8'))
  const foods = file('food.csv')
    .filter(row => DATA_TYPES.has(row[1]!))
    .map(row => ({ fdc_id: Number(row[0]), data_type: row[1]!, description: row[2]! }))
  const kept = new Set(foods.map(food => food.fdc_id))
  // Foundation Foods names the unit; SR Legacy says "undetermined" and puts
  // it in the modifier ("cup, chopped").
  const units = new Map(file('measure_unit.csv').map(row => [row[0]!, row[1]!]))
  const portions: Portion[] = []
  for (const row of file('food_portion.csv')) {
    const fdcId = Number(row[1])
    const unitName = units.get(row[4]!)
    const modifier = unitName && unitName !== 'undetermined' ? [unitName, row[6]].filter(Boolean).join(', ') : row[6]!
    const unit = unitOf(modifier)
    const amount = Number(row[3]), grams = Number(row[7])
    if (kept.has(fdcId) && unit && amount > 0 && grams > 0) portions.push({ fdc_id: fdcId, amount, unit, modifier, grams })
  }
  return { foods, portions }
}

/**
 * Replaces fdc_foods and fdc_portions with the downloads in `dirs`, in one
 * transaction, so a rerun with a newer release leaves no mix of the two.
 */
export async function loadFdc(sql: Sql, dirs: string[]): Promise<{ foods: number, portions: number }> {
  const all = dirs.map(read)
  const foods = all.flatMap(one => one.foods)
  const portions = all.flatMap(one => one.portions)
  await sql.begin(async (tx) => {
    await tx`DELETE FROM fdc_foods`
    for (let i = 0; i < foods.length; i += 1000) await tx`INSERT INTO fdc_foods ${tx(foods.slice(i, i + 1000))}`
    for (let i = 0; i < portions.length; i += 1000) await tx`INSERT INTO fdc_portions ${tx(portions.slice(i, i + 1000))}`
  })
  return { foods: foods.length, portions: portions.length }
}

// One clear hit, measured on the 420 seeded entries, whose FDC food was
// picked by hand (docs/extraction.md has the numbers): the best match by
// trigram similarity, at least this good, and this far ahead of the next.
const SCORE = 0.4
const LEAD = 0.1

export type FdcMatch = { fdcId: number, fdc: string, portion: string, gramsPerMl: number }

/**
 * The FDC food and density for a learned key's name, or null. Only one clear
 * best hit with a cup or spoon portion counts, and only when the name's last
 * word is in what FDC lists first ("Oil, avocado" is not avocado). A missing
 * density is honest; a wrong one corrupts every conversion the key is in.
 */
export async function fdcMatch(sql: Sql, name: string): Promise<FdcMatch | null> {
  const [best, next] = await sql<{ fdc_id: number, description: string, score: number }[]>`
    SELECT fdc_id, description, similarity(lower(description), ${name}) AS score
    FROM fdc_foods WHERE lower(description) % ${name}
    ORDER BY score DESC, fdc_id
    LIMIT 2
  `
  if (!best || best.score < SCORE || (next && best.score - next.score < LEAD)) return null
  if (!best.description.toLowerCase().split(',')[0]!.includes(name.split(' ').at(-1)!)) return null
  // A cup is measured more precisely than a spoon, so the largest measure wins.
  const [portion] = await sql<{ amount: number, unit: string, modifier: string, grams: number }[]>`
    SELECT amount, unit, modifier, grams FROM fdc_portions WHERE fdc_id = ${best.fdc_id}
    ORDER BY array_position(ARRAY['cup', 'tbsp', 'tsp', 'fl oz'], unit), modifier, grams
    LIMIT 1
  `
  if (!portion) return null
  return {
    fdcId: best.fdc_id,
    fdc: best.description,
    portion: `${portion.amount} ${portion.modifier} = ${portion.grams} g`,
    gramsPerMl: Math.round(portion.grams / (portion.amount * ML[portion.unit]!) * 10000) / 10000,
  }
}
