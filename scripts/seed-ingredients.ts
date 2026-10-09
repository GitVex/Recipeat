// Seeds the ingredient store (#171) from the Open Food Facts ingredients that
// carry a USDA FoodData Central id, with their names in every language and a
// density from FDC's cup and spoon portions. The rest of OFF is left out.
// It runs once, against an empty store; a seeded mistake is fixed by hand.
//
//   npm run seed:ingredients
//
// It downloads both dumps into a temporary folder, seeds from there, and
// removes the folder afterwards, whether the seed worked or not.
//
// OFF is ODbL and FDC public domain; docs/database.md has the attribution.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateRawSync } from 'node:zlib'
import postgres, { type Sql } from 'postgres'

// What the seed reads of an OFF taxonomy entry. `synonyms` holds every name
// per language, the first being the one OFF shows.
export type OffEntry = { synonyms?: Record<string, string[]>, usda_fdc_code?: { en?: string } }
export type SeedReport = { ingredients: number, withDensity: number, duplicates: { lang: string, name: string, entries: string[] }[] }

// FDC measures in US cups and spoons, cup first: the larger measure is the
// more precise one.
const ML = { cup: 236.588, tbsp: 14.7868, tsp: 4.92892 }
const ORDER = Object.keys(ML)
const VOLUME = /^(cups?|tbsp|tablespoons?|tsp|teaspoons?)\b,?\s*(.*)$/i

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

type Portion = { id: string, unit: keyof typeof ML, plain: boolean, grams: number, amount: number }

// FDC food id → its cup and spoon portions, from food_portion.csv. `plain` is
// a portion with no modifier: "cup" rather than "cup, chopped".
export function readPortions(text: string): Map<string, Portion[]> {
  const portions = new Map<string, Portion[]>()
  for (const [id, fdcId, , amount, , , modifier, grams] of csv(text)) {
    const match = VOLUME.exec(modifier!.trim())
    if (!match) continue
    const word = match[1]!.toLowerCase()
    const unit = word.startsWith('cup') ? 'cup' : word.startsWith('tb') || word.startsWith('table') ? 'tbsp' : 'tsp'
    if (!portions.has(fdcId!)) portions.set(fdcId!, [])
    portions.get(fdcId!)!.push({ id: id!, unit, plain: match[2] === '', grams: Number(grams), amount: Number(amount) })
  }
  return portions
}

// The best portion across an entry's FDC ids (sort is stable, so FDC's own
// order breaks ties), kept only if it lands in 0.1–2.5 g/ml; past that it is
// more likely a mismeasure than a food.
function density(fdcIds: string[], portions: Map<string, Portion[]>) {
  const portion = fdcIds.flatMap(id => portions.get(id) ?? [])
    .sort((a, b) => Number(b.plain) - Number(a.plain) || ORDER.indexOf(a.unit) - ORDER.indexOf(b.unit))[0]
  if (!portion) return null
  const value = Math.round(portion.grams / (portion.amount * ML[portion.unit]) * 10000) / 10000
  return value >= 0.1 && value <= 2.5 ? { value, ref: portion.id } : null
}

export async function seedIngredients(sql: Sql, taxonomy: Record<string, OffEntry>, portions: Map<string, Portion[]>): Promise<SeedReport> {
  const entries = Object.entries(taxonomy).flatMap(([offId, entry]) => {
    // Some entries carry an SR Legacy and a Foundation id: "170379, 321900".
    const fdcIds = entry.usda_fdc_code?.en?.split(',').map(id => id.trim()).filter(Boolean) ?? []
    return fdcIds.length ? [{ offId, fdcIds, synonyms: entry.synonyms ?? {} }] : []
  })

  // A name OFF gives two entries in one language could be either, so it is
  // given to neither; a line using it falls to the close match.
  const owners = new Map<string, Set<string>>()
  for (const { offId, synonyms } of entries) {
    for (const [lang, names] of Object.entries(synonyms)) {
      for (const name of names) {
        const key = `${lang}:${name.toLowerCase()}`
        owners.set(key, (owners.get(key) ?? new Set()).add(offId))
      }
    }
  }
  const duplicates = [...owners].filter(([, ids]) => ids.size > 1)
    .map(([key, ids]) => ({ lang: key.slice(0, key.indexOf(':')), name: key.slice(key.indexOf(':') + 1), entries: [...ids] }))

  return sql.begin(async sql => {
    const [{ any }] = await sql<{ any: boolean }[]>`SELECT EXISTS (SELECT 1 FROM ingredients) AS any`
    if (any) throw new Error('The ingredient store already has entries; the seed runs once, against an empty one.')
    let withDensity = 0
    for (const { offId, fdcIds, synonyms } of entries) {
      const found = density(fdcIds, portions)
      if (found) withDensity++
      const [{ id }] = await sql<{ id: string }[]>`
        INSERT INTO ingredients (density_g_per_ml, density_source, density_ref)
        VALUES (${found?.value ?? null}, ${found ? 'fdc' : null}, ${found?.ref ?? null})
        RETURNING id`
      await sql`INSERT INTO ingredient_sources ${sql([
        { ingredient_id: id, source: 'off', external_id: offId },
        ...fdcIds.map(fdc => ({ ingredient_id: id, source: 'fdc', external_id: fdc })),
      ])}`
      const names = Object.entries(synonyms).flatMap(([lang, list]) => {
        const seen = new Set<string>()
        return list.filter(name => {
          const key = `${lang}:${name.toLowerCase()}`
          if (seen.has(key) || owners.get(key)!.size > 1) return false
          seen.add(key)
          return true
        }).map((name, i) => ({ ingredient_id: id, lang, name, is_main: i === 0, confirmed: true, source: 'off' }))
      })
      if (names.length) await sql`INSERT INTO ingredient_names ${sql(names)}`
    }
    return { ingredients: entries.length, withDensity, duplicates }
  })
}

const OFF_URL = 'https://static.openfoodfacts.org/data/taxonomies/ingredients.full.json'
const FDC_URL = 'https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_csv_2018-04.zip'

async function download(url: string, file: string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url}: ${response.status}`)
  writeFileSync(file, Buffer.from(await response.arrayBuffer()))
}

// One file out of a zip, by the end of its name, read from the central
// directory. Enough for FDC's archive, so there is no unzip to depend on.
// ponytail: no zip64 and only stored or deflated entries; FDC's 6 MB zip is neither.
function unzipOne(zip: Buffer, suffix: string): Buffer {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (end < 0) throw new Error('Not a zip file')
  let at = zip.readUInt32LE(end + 16)
  for (let i = zip.readUInt16LE(end + 10); i > 0; i--) {
    const method = zip.readUInt16LE(at + 10), size = zip.readUInt32LE(at + 20)
    const nameLength = zip.readUInt16LE(at + 28), local = zip.readUInt32LE(at + 42)
    const name = zip.toString('utf8', at + 46, at + 46 + nameLength)
    if (name.endsWith(suffix)) {
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
      const data = zip.subarray(start, start + size)
      return method === 8 ? inflateRawSync(data) : data
    }
    at += 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32)
  }
  throw new Error(`No ${suffix} in the zip`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = mkdtempSync(join(tmpdir(), 'recipeat-seed-'))
  const sql = postgres(process.env.NUXT_DATABASE_URL!, { onnotice: () => {} })
  try {
    // seedIngredients checks again inside its transaction; this one only
    // saves the download.
    const [{ any }] = await sql<{ any: boolean }[]>`SELECT EXISTS (SELECT 1 FROM ingredients) AS any`
    if (any) throw new Error('The ingredient store already has entries; the seed runs once, against an empty one.')
    console.log(`Downloading into ${dir}`)
    await Promise.all([download(OFF_URL, join(dir, 'off.json')), download(FDC_URL, join(dir, 'fdc.zip'))])
    const portions = unzipOne(readFileSync(join(dir, 'fdc.zip')), '/food_portion.csv').toString('utf8')
    const report = await seedIngredients(sql, JSON.parse(readFileSync(join(dir, 'off.json'), 'utf8')), readPortions(portions))
    console.log(`${report.ingredients} ingredients, ${report.withDensity} with a density`)
    console.log(`${report.duplicates.length} names on two entries, seeded on neither:`)
    for (const { lang, name, entries } of report.duplicates) console.log(`  ${lang} "${name}": ${entries.join(', ')}`)
  } finally {
    await sql.end()
    rmSync(dir, { recursive: true, force: true })
  }
}
