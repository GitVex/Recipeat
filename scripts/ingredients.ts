// Fills in what server/extraction/ingredients.json takes from USDA FoodData
// Central (#132): each entry's FDC description, the portion its density comes
// from, and that density in grams per millilitre. The keys, FDC ids, forms
// and names are written by hand; everything else here is derived, so a fresh
// FDC release is one rerun.
//
//   1. Download "SR Legacy" as CSV from https://fdc.nal.usda.gov/download-datasets
//   2. node --experimental-strip-types scripts/ingredients.ts <unzipped folder>
//
// FoodData Central is public domain (CC0); USDA asks that it be named as the
// source, which docs/extraction.md does.

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { matchKey, type FoodEntry } from '../server/extraction/ingredients.ts'

const FILE = new URL('../tests/ingredients.json', import.meta.url)

// FDC measures in US cups and spoons.
const ML: Record<string, number> = { cup: 236.588, tbsp: 14.7868, tsp: 4.92892, 'fl oz': 29.5735 }
const VOLUME = /^(cups?|tbsp|tablespoons?|tsp|teaspoons?|fl oz)\b/i
const unitOf = (modifier: string) => {
  const word = VOLUME.exec(modifier)?.[1]!.toLowerCase()
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

const dir = process.argv[2]
if (!dir) throw new Error('Usage: scripts/ingredients.ts <FDC SR Legacy CSV folder>')

const descriptions = new Map(csv(readFileSync(join(dir, 'food.csv'), 'utf8')).map(r => [Number(r[0]), r[2]!]))
type Portion = { amount: number, modifier: string, grams: number }
const portions = new Map<number, Portion[]>()
for (const r of csv(readFileSync(join(dir, 'food_portion.csv'), 'utf8'))) {
  const id = Number(r[1])
  if (!portions.has(id)) portions.set(id, [])
  portions.get(id)!.push({ amount: Number(r[3]), modifier: r[6]!, grams: Number(r[7]) })
}

// A cup is measured more precisely than a teaspoon, so the largest measure
// wins unless the entry names its portion; `pick: "-"` means none of them fits.
const ORDER = ['cup', 'tbsp', 'tsp', 'fl oz']
function portionFor(entry: FoodEntry): Portion | null {
  if (entry.pick === '-') return null
  const volumes = (portions.get(entry.fdcId!) ?? []).filter(p => unitOf(p.modifier))
  if (entry.pick) {
    const found = volumes.find(p => p.modifier === entry.pick) ?? volumes.find(p => p.modifier.startsWith(entry.pick!))
    if (!found) throw new Error(`${entry.key}: no portion "${entry.pick}" on FDC ${entry.fdcId}`)
    return found
  }
  return volumes.sort((a, b) => ORDER.indexOf(unitOf(a.modifier)!) - ORDER.indexOf(unitOf(b.modifier)!))[0] ?? null
}

const entries: FoodEntry[] = JSON.parse(readFileSync(FILE, 'utf8'))
const keys = new Set<string>()
const names = { en: new Map<string, string>(), de: new Map<string, string>() }
for (const entry of entries) {
  if (keys.has(entry.key)) throw new Error(`Duplicate key ${entry.key}`)
  keys.add(entry.key)
  for (const lang of ['en', 'de'] as const) {
    for (const name of entry[lang]) {
      const other = names[lang].get(matchKey(name))
      if (other && other !== entry.key) throw new Error(`"${name}" (${lang}) is both ${other} and ${entry.key}`)
      names[lang].set(matchKey(name), entry.key)
    }
  }
  // Some common foods aren't in FDC at all (harissa, paneer, Quark). They get
  // a key and names, so they still match and merge, and no density.
  if (entry.fdcId === null) {
    if (entry.pick) throw new Error(`${entry.key}: a portion to pick, but no FDC food to pick it from`)
    Object.assign(entry, { fdc: null, portion: null, gramsPerMl: null })
    continue
  }
  const description = descriptions.get(entry.fdcId)
  if (!description) throw new Error(`${entry.key}: FDC ${entry.fdcId} is not in SR Legacy`)
  entry.fdc = description
  const portion = portionFor(entry)
  entry.portion = portion ? `${portion.amount} ${portion.modifier} = ${portion.grams} g` : null
  entry.gramsPerMl = portion ? Math.round(portion.grams / (portion.amount * ML[unitOf(portion.modifier)!]!) * 10000) / 10000 : null
}

// One entry per line, so a review reads as a list and a diff as a change to one food.
const ordered = entries.map(({ key, fdcId, fdc, form, pick, portion, gramsPerMl, en, de }) =>
  JSON.stringify({ key, fdcId, fdc, form, ...(pick && { pick }), portion, gramsPerMl, en, de }))
writeFileSync(FILE, `[\n${ordered.join(',\n')}\n]\n`)
console.log(`${entries.length} ingredients, ${entries.filter(e => e.gramsPerMl).length} with a density`)
