import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import postgres, { type Sql } from 'postgres'
import { Kysely } from 'kysely'
import { PostgresJSDialect } from 'kysely-postgres-js'
import { applyMigrations } from '../server/database/migrate.ts'
import type { Database } from '../server/database/schema.ts'
import { normalizeRecipe, parseExtraction } from '../server/utils/extraction.ts'
import { deleteRecipe, findRecipe, insertProgression, insertRecipe, insertVariant, listing, listRecipes, pinRecipe, readHistory, updateRecipe } from '../server/recipes/store.ts'
import { addToCollection, collectionsContaining, createCollection, deleteCollection, listCollections, readCollection, removeFromCollection, renameCollection, reorderCollection } from '../server/collections/store.ts'
import { listTags, setTags } from '../server/tags/store.ts'
import { addPhoto, arrangePhotos, deleteImage, listPhotos, readImage, setSourcePhoto } from '../server/images/store.ts'
import { readPreferences, writePreferences } from '../server/utils/preferences.ts'
import { NO_FILTERS, readFilters } from '../shared/utils/recipeFilters.ts'
import { validateRecipe } from '../server/recipes/validate.ts'
import { readPortions, seedIngredients } from '../scripts/seed-ingredients.ts'
import { drainQueue, MATCHED, matchNext, previewQuestions } from '../server/ingredients/match.ts'
import { answerQuestion, countWaiting, readQuestions } from '../server/ingredients/answer.ts'
import { NO_PREFERENCES } from '../shared/utils/preferences.ts'
import { lookUpDue } from '../server/ingredients/lookup.ts'

// The half of the runner that needs a database. Everything here happens inside
// a schema of its own, so a development database keeps its own
// schema_migrations and its own tables:
//
//   NUXT_DATABASE_URL=postgres://recipeat:...@127.0.0.1:5432/recipeat \
//     npm run test:database:live
//
// docs/database.md has the container it points at.
const url = process.env.NUXT_DATABASE_URL
const SCHEMA = 'migration_test'

// The real files, read as the runner reads them at startup.
const migrations = (...versions: string[]) => versions.map(version => ({
  version,
  sql: readFileSync(new URL(`../server/database/migrations/${version}`, import.meta.url), 'utf8'),
}))
// What the stores need under them.
const STORE = ['001_recipes.sql', '002_collections.sql', '003_tags.sql', '004_preferences.sql', '005_images.sql', '006_ingredients.sql', '007_ingredient_matching.sql']

describe('migration runner', { skip: url ? false : 'NUXT_DATABASE_URL is not set' }, () => {
  let admin: Sql
  let sql: Sql

  before(async () => {
    admin = postgres(url!, { max: 1, onnotice: () => {} })
    await admin`DROP SCHEMA IF EXISTS ${admin(SCHEMA)} CASCADE`
    await admin`CREATE SCHEMA ${admin(SCHEMA)}`
    // Every table the runner touches — schema_migrations included — resolves
    // here rather than in public.
    sql = postgres(url!, { max: 10, onnotice: () => {}, connection: { search_path: SCHEMA } })
  })

  after(async () => {
    await sql?.end()
    await admin`DROP SCHEMA IF EXISTS ${admin(SCHEMA)} CASCADE`
    await admin?.end()
  })

  const migration = (version: string, body: string) => ({ version, sql: body })
  const one = migration('001_a.sql', 'CREATE TABLE a (id INT PRIMARY KEY);\nINSERT INTO a VALUES (1);')
  const two = migration('002_b.sql', 'CREATE TABLE b (id INT PRIMARY KEY, note TEXT);\nCREATE INDEX b_note_idx ON b (note) WHERE note IS NOT NULL;')
  const three = migration('003_c.sql', 'ALTER TABLE b ADD COLUMN extra JSONB;')
  const broken = migration('004_broken.sql', 'CREATE TABLE d (id INT);\nTHIS IS NOT SQL;')
  const five = migration('005_e.sql', 'CREATE TABLE e (id INT);')

  const versions = async () => (await sql<{ version: string }[]>`SELECT version FROM schema_migrations ORDER BY version`).map(row => row.version)
  const exists = async (table: string) => (await sql<{ yes: boolean }[]>`SELECT to_regclass(${`${SCHEMA}.${table}`}) IS NOT NULL AS yes`)[0].yes
  const count = async (query: Promise<{ n: number }[]>) => (await query)[0].n

  test('applies every migration in order, whole files at a time', async () => {
    assert.deepEqual(await applyMigrations(sql, [one, two]), ['001_a.sql', '002_b.sql'])
    assert.deepEqual(await versions(), ['001_a.sql', '002_b.sql'])
    // A file is several statements and all of them ran: the insert after the
    // create, and the index after the table.
    assert.equal(await count(sql<{ n: number }[]>`SELECT count(*)::int AS n FROM a`), 1)
    assert.equal(await count(sql<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_indexes WHERE schemaname = ${SCHEMA} AND indexname = 'b_note_idx'`), 1)
  })

  test('re-running applies nothing', async () => {
    assert.deepEqual(await applyMigrations(sql, [one, two]), [])
    assert.deepEqual(await versions(), ['001_a.sql', '002_b.sql'])
  })

  test('a new file is the only one applied', async () => {
    assert.deepEqual(await applyMigrations(sql, [one, two, three]), ['003_c.sql'])
    assert.equal(await count(sql<{ n: number }[]>`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema = ${SCHEMA} AND table_name = 'b' AND column_name = 'extra'`), 1)
  })

  test('a failure rolls back the whole file and its ledger row', async () => {
    await assert.rejects(() => applyMigrations(sql, [one, two, three, broken]))
    assert.deepEqual(await versions(), ['001_a.sql', '002_b.sql', '003_c.sql'])
    // The statement before the bad one has to be gone too, or the next run
    // starts from a state no migration describes.
    assert.equal(await exists('d'), false)
  })

  test('two runners at once: one applies, the other finds nothing', async () => {
    const [left, right] = await Promise.all([
      applyMigrations(sql, [one, two, three, five]),
      applyMigrations(sql, [one, two, three, five]),
    ])
    assert.deepEqual([...left, ...right], ['005_e.sql'], `applied twice: ${JSON.stringify([left, right])}`)
    assert.equal(await count(sql<{ n: number }[]>`SELECT count(*)::int AS n FROM schema_migrations WHERE version = '005_e.sql'`), 1)
  })

  test('no advisory lock is left held', async () => {
    assert.equal(await count(sql<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory'`), 0)
  })
})

// The schema itself: what 001_recipes.sql refuses, and what it does on its
// own. Lineage is most of it — a constraint that only fires on a delete, or
// on a second pin, is not something the SQL can be read for.
describe('recipes schema', { skip: url ? false : 'NUXT_DATABASE_URL is not set' }, () => {
  const SCHEMA = 'schema_check'
  let admin: Sql
  let sql: Sql
  let db: Kysely<Database>
  let root: { id: string, line_id: string }
  let progression: { id: string }
  let branch: { id: string }
  let variant: { id: string, line_id: string }

  before(async () => {
    admin = postgres(url!, { max: 1, onnotice: () => {} })
    await admin`DROP SCHEMA IF EXISTS ${admin(SCHEMA)} CASCADE`
    await admin`CREATE SCHEMA ${admin(SCHEMA)}`
    sql = postgres(url!, { max: 5, onnotice: () => {}, connection: { search_path: SCHEMA } })
    // Through the runner, not psql: the file has to survive the same path it
    // takes in production, dollar-quoted function bodies included.
    const version = '001_recipes.sql'
    const body = readFileSync(new URL(`../server/database/migrations/${version}`, import.meta.url), 'utf8')
    assert.deepEqual(await applyMigrations(sql, [{ version, sql: body }]), [version])
  })

  after(async () => {
    await sql?.end()
    await admin`DROP SCHEMA IF EXISTS ${admin(SCHEMA)} CASCADE`
    await admin?.end()
  })

  // JSONB wants sql.json: a string parameter is stored as a JSON string, and
  // the array checks below are what catches that.
  const recipe = (owner = 'user_a', extra: Record<string, unknown> = {}) => ({
    owner_sub: owner,
    title: 'Toast',
    source_lang: 'en',
    ingredients: sql.json([{ name: 'bread' }]),
    steps: sql.json(['Toast it.']),
    source: sql.json({ type: 'text', originalText: 'x' }),
    ...extra,
  })
  const insert = async (row: Record<string, unknown>) => (await sql`INSERT INTO recipes ${sql(row)} RETURNING *`)[0] as Record<string, any>
  const count = async (query: Promise<{ n: number }[]>) => (await query)[0].n
  const refuses = (query: () => Promise<unknown>, pattern: RegExp) => assert.rejects(query, pattern)

  test('a root row is its own line, and says so without being told', async () => {
    root = await insert(recipe('user_a', { pinned: true })) as typeof root
    assert.equal(root.line_id, root.id, 'line_id did not default to the row id')
    assert.deepEqual([(root as any).progression_of, (root as any).variant_of, (root as any).total_time], [null, null, null])
  })

  test('a progression joins the line and the pin moves with it', async () => {
    await sql.begin(async (tx) => {
      await tx`UPDATE recipes SET pinned = false WHERE line_id = ${root.line_id} AND pinned`
      await tx`INSERT INTO recipes ${tx(recipe('user_a', { line_id: root.line_id, progression_of: root.id, pinned: true }))}`
    })
    const line = await sql<{ id: string, pinned: boolean }[]>`SELECT id, pinned FROM recipes WHERE line_id = ${root.line_id} ORDER BY created_at`
    assert.deepEqual(line.map(row => row.pinned), [false, true])
    progression = line[1]
  })

  test('a version can have two progressions: a line is a tree', async () => {
    branch = await insert(recipe('user_a', { line_id: root.line_id, progression_of: root.id })) as typeof branch
    assert.equal(await count(sql<{ n: number }[]>`SELECT count(*)::int AS n FROM recipes WHERE progression_of = ${root.id}`), 2)
  })

  test('a line cannot have two pins', async () => {
    await refuses(() => sql`UPDATE recipes SET pinned = true WHERE id = ${branch.id}`, /recipes_line_pin_idx/)
  })

  test('a variant starts a line of its own', async () => {
    variant = await insert(recipe('user_a', { variant_of: progression.id, pinned: true })) as typeof variant
    assert.equal(variant.line_id, variant.id)
    assert.notEqual(variant.line_id, root.line_id)
  })

  test('lineage cannot cross owners', async () => {
    // The composite foreign key is why this fails in the schema rather than in
    // whichever route forgot to check.
    await refuses(() => insert(recipe('user_b', { line_id: root.line_id, progression_of: root.id })), /foreign key/i)
  })

  test('a row cannot be its own parent, or both kinds at once', async () => {
    await refuses(() => sql`UPDATE recipes SET progression_of = ${branch.id} WHERE id = ${branch.id}`, /check/i)
    await refuses(() => insert(recipe('user_a', { progression_of: root.id, variant_of: root.id, line_id: root.line_id })), /check/i)
  })

  test('the content constraints hold', async () => {
    await refuses(() => insert(recipe('user_a', { portions: 0 })), /check/i)
    await refuses(() => insert(recipe('user_a', { total_time: 0 })), /check/i)
    await refuses(() => insert(recipe('user_a', { total_time: 60 * 24 * 30 + 1 })), /check/i)
    await refuses(() => insert(recipe('user_a', { ingredients: sql.json({ not: 'an array' }) })), /check/i)
    await refuses(() => insert(recipe('user_a', { steps: sql.json('nope') })), /check/i)
    await refuses(() => insert(recipe('user_a', { source: sql.json([1]) })), /check/i)
  })

  test('updated_at moves on update and created_at does not', async () => {
    const [before] = await sql<{ created_at: Date, updated_at: Date }[]>`SELECT created_at, updated_at FROM recipes WHERE id = ${branch.id}`
    await sql`UPDATE recipes SET title = 'Toast, corrected' WHERE id = ${branch.id}`
    const [after] = await sql<{ created_at: Date, updated_at: Date }[]>`SELECT created_at, updated_at FROM recipes WHERE id = ${branch.id}`
    assert.equal(after.created_at.getTime(), before.created_at.getTime())
    assert.ok(after.updated_at.getTime() > before.updated_at.getTime(), 'updated_at did not move')
  })

  test('deleting a version takes its progressions and spares its variants', async () => {
    await sql`DELETE FROM recipes WHERE id = ${root.id}`
    assert.equal(await count(sql<{ n: number }[]>`SELECT count(*)::int AS n FROM recipes WHERE line_id = ${root.line_id}`), 0)
    const [survivor] = await sql<{ variant_of: string | null, pinned: boolean }[]>`SELECT variant_of, pinned FROM recipes WHERE id = ${variant.id}`
    assert.ok(survivor, 'the variant went with the version it branched off')
    // It became its own recipe, and is left pointing at nothing.
    assert.equal(survivor.variant_of, null)
    assert.equal(survivor.pinned, true)
  })

  test('the listing query uses the partial index', async () => {
    const plan = (await sql<{ 'QUERY PLAN': string }[]>`EXPLAIN SELECT id FROM recipes WHERE owner_sub = 'user_a' AND pinned ORDER BY created_at DESC`)
      .map(row => row['QUERY PLAN']).join('\n')
    assert.match(plan, /recipes_owner_pinned_idx/, plan)
  })
})

// The store: what the three routes in #7 actually do to the table, minus the
// session and the HTTP envelope.
describe('recipes store', { skip: url ? false : 'NUXT_DATABASE_URL is not set' }, () => {
  const SCHEMA = 'store_check'
  let admin: Sql
  let sql: Sql
  let db: Kysely<Database>

  before(async () => {
    admin = postgres(url!, { max: 1, onnotice: () => {} })
    await admin`DROP SCHEMA IF EXISTS ${admin(SCHEMA)} CASCADE`
    await admin`CREATE SCHEMA ${admin(SCHEMA)}`
    sql = postgres(url!, { max: 5, onnotice: () => {}, connection: { search_path: SCHEMA } })
    // Kysely over the same instance, so both layers see the same search_path
    // and the same pool — which is how the app wires them too.
    db = new Kysely<Database>({ dialect: new PostgresJSDialect({ postgres: sql }) })
    // Every migration, not only the recipes table's: a read carries the
    // line's tags, so the tables they live in have to be there.
    await applyMigrations(sql, migrations(...STORE))
  })

  after(async () => {
    await sql?.end()
    await admin`DROP SCHEMA IF EXISTS ${admin(SCHEMA)} CASCADE`
    await admin?.end()
  })

  const recipe = (title: string) => normalizeRecipe(parseExtraction({
    title,
    source_lang: 'en',
    portions: 2,
    totalTime: 25,
    ingredients: [{ originalText: '200 g flour', quantity: '200 g', name: 'flour' }],
    steps: ['Mix the 200 g flour in.'],
  }, { type: 'text', originalText: title }))

  test('a saved recipe comes back as the recipe that went in', async () => {
    const saved = await insertRecipe(db, 'user_a', recipe('Bread'))
    const found = await findRecipe(sql, 'user_a', saved.id)
    assert.deepEqual(found, saved)
    // The row is the first version of its own line, and the entry point for it.
    assert.equal(saved.lineId, saved.id)
    assert.equal(saved.pinned, true)
    assert.deepEqual([saved.progressionOf, saved.variantOf], [null, null])
    // JSONB round-trips whole: the parts and the links normalizeRecipe found,
    // and no store entry on any line yet (#181).
    assert.deepEqual(found!.ingredients, recipe('Bread').ingredients.map(line => ({ ...line, ingredient: null })))
    assert.equal(found!.steps[0]!.parts.some(part => part.type === 'ingredientQuantity'), true)
    // NUMERIC arrives as a string and is read back to what was stored.
    assert.equal(found!.portions, 2)
    assert.equal(found!.totalTime, 25)
  })

  test('a listing is one entry per line, newest first', async () => {
    await insertRecipe(db, 'user_a', recipe('Soup'))
    const listed = await listRecipes(sql, 'user_a')
    assert.deepEqual(listed.map(row => row.title), ['Soup', 'Bread'])
    assert.deepEqual(listed[0]!.ingredientCount, 1)
    assert.deepEqual(listed[0]!.stepCount, 1)
  })

  test('an unpinned version is in no listing', async () => {
    const [{ id, line_id }] = await sql<{ id: string, line_id: string }[]>`SELECT id, line_id FROM recipes WHERE title = 'Soup'`
    await sql.begin(async (tx) => {
      await tx`UPDATE recipes SET pinned = false WHERE id = ${id}`
      await tx`INSERT INTO recipes (owner_sub, title, source_lang, ingredients, steps, line_id, progression_of, pinned)
               VALUES ('user_a', 'Soup, again', 'en', '[]'::jsonb, '[]'::jsonb, ${line_id}, ${id}, true)`
    })
    const listed = await listRecipes(sql, 'user_a')
    assert.deepEqual(listed.map(row => row.title), ['Soup, again', 'Bread'], 'the superseded version is still listed')
    // Still readable by id, which is what the lineage view reaches it through.
    assert.ok(await findRecipe(sql, 'user_a', id))
  })

  test('one user cannot read another user\'s rows', async () => {
    const mine = await insertRecipe(db, 'user_a', recipe('Private'))
    assert.equal(await findRecipe(sql, 'user_b', mine.id), null)
    assert.equal((await listRecipes(sql, 'user_b')).length, 0)
    const theirs = await insertRecipe(db, 'user_b', recipe('Theirs'))
    assert.deepEqual((await listRecipes(sql, 'user_b')).map(row => row.title), ['Theirs'])
    assert.equal(await findRecipe(sql, 'user_a', theirs.id), null)
  })
})

// The three writes in #29: what each one does to a line, and what it refuses.
describe('recipes lineage writes', { skip: url ? false : 'NUXT_DATABASE_URL is not set' }, () => {
  const SCHEMA = 'writes_check'
  let admin: Sql
  let sql: Sql
  let db: Kysely<Database>

  before(async () => {
    admin = postgres(url!, { max: 1, onnotice: () => {} })
    await admin`DROP SCHEMA IF EXISTS ${admin(SCHEMA)} CASCADE`
    await admin`CREATE SCHEMA ${admin(SCHEMA)}`
    sql = postgres(url!, { max: 5, onnotice: () => {}, connection: { search_path: SCHEMA } })
    // Kysely over the same instance, so both layers see the same search_path
    // and the same pool — which is how the app wires them too.
    db = new Kysely<Database>({ dialect: new PostgresJSDialect({ postgres: sql }) })
    // Every migration, not only the recipes table's: a read carries the
    // line's tags, so the tables they live in have to be there.
    await applyMigrations(sql, migrations(...STORE))
  })

  after(async () => {
    await sql?.end()
    await admin`DROP SCHEMA IF EXISTS ${admin(SCHEMA)} CASCADE`
    await admin?.end()
  })

  const recipe = (title: string) => normalizeRecipe(parseExtraction({
    title,
    source_lang: 'en',
    portions: 2,
    ingredients: [{ originalText: '200 g flour', quantity: '200 g', name: 'flour' }],
    steps: ['Mix the 200 g flour in.'],
  }, { type: 'text', originalText: title }))

  const pinnedIn = async (lineId: string) => sql<{ id: string, title: string | null }[]>`
    SELECT id, title FROM recipes WHERE line_id = ${lineId} AND pinned
  `

  test('Save corrects a version in place and touches nothing else', async () => {
    const first = await insertRecipe(db, 'user_a', recipe('Focaccia'))
    const saved = await updateRecipe(sql, 'user_a', first.id, recipe('Focaccia, salted'))
    assert.equal(saved!.id, first.id)
    assert.equal(saved!.title, 'Focaccia, salted')
    // Same row, same place in the tree.
    assert.deepEqual(
      [saved!.lineId, saved!.progressionOf, saved!.variantOf, saved!.pinned],
      [first.lineId, null, null, true],
    )
    assert.equal(saved!.createdAt, first.createdAt)
    assert.ok(saved!.updatedAt > first.updatedAt, 'updated_at did not move')
    assert.equal((await pinnedIn(first.lineId)).length, 1)
  })

  test('Save as Progression joins the line and takes the pin', async () => {
    const root = await insertRecipe(db, 'user_a', recipe('Stock'))
    const second = await insertProgression(db, 'user_a', root.id, recipe('Stock, roasted bones'))
    assert.equal(second!.lineId, root.lineId)
    assert.equal(second!.progressionOf, root.id)
    assert.equal(second!.variantOf, null)
    assert.deepEqual((await pinnedIn(root.lineId)).map(row => row.id), [second!.id])

    // A progression of a progression extends the tree rather than starting a
    // line of its own.
    const third = await insertProgression(db, 'user_a', second!.id, recipe('Stock, roasted and reduced'))
    assert.equal(third!.lineId, root.lineId)
    assert.equal(third!.progressionOf, second!.id)
    assert.deepEqual((await pinnedIn(root.lineId)).map(row => row.id), [third!.id])
  })

  test('a progression can be made from any version, pinned or not', async () => {
    const root = await insertRecipe(db, 'user_a', recipe('Pancakes'))
    const second = await insertProgression(db, 'user_a', root.id, recipe('Pancakes, buttermilk'))
    // Back to the original, which is no longer the entry point, and onwards
    // from there. The pin follows, wherever in the tree it was made.
    const branch = await insertProgression(db, 'user_a', root.id, recipe('Pancakes, thinner'))
    assert.equal(branch!.progressionOf, root.id)
    assert.equal(branch!.lineId, root.lineId)
    assert.deepEqual((await pinnedIn(root.lineId)).map(row => row.id), [branch!.id])
    // Two children of one version: the line is a tree.
    assert.equal((await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM recipes WHERE progression_of = ${root.id}`)[0]!.n, 2)
    assert.equal((await findRecipe(sql, 'user_a', second!.id))!.pinned, false)
  })

  test('Save as Variant leaves the line and starts its own', async () => {
    const root = await insertRecipe(db, 'user_a', recipe('Chili'))
    const variant = await insertVariant(db, 'user_a', root.id, recipe('Chili, no beans'))
    assert.equal(variant!.lineId, variant!.id)
    assert.equal(variant!.variantOf, root.id)
    assert.equal(variant!.progressionOf, null)
    assert.equal(variant!.pinned, true)
    // The line it left is untouched: its own pin is still its own.
    assert.deepEqual((await pinnedIn(root.lineId)).map(row => row.id), [root.id])
    // And it is its own entry in a listing, like an import.
    const listed = await listRecipes(sql, 'user_a')
    assert.equal(listed.filter(row => row.id === variant!.id).length, 1)
  })

  test('none of the three touch another owner\'s rows', async () => {
    const mine = await insertRecipe(db, 'user_a', recipe('Mine'))
    assert.equal(await updateRecipe(sql, 'user_b', mine.id, recipe('Theirs now')), null)
    assert.equal(await insertProgression(db, 'user_b', mine.id, recipe('Theirs now')), null)
    assert.equal(await insertVariant(db, 'user_b', mine.id, recipe('Theirs now')), null)
    // Not merely refused — nothing was written, and the pin did not move.
    assert.equal((await findRecipe(sql, 'user_a', mine.id))!.title, 'Mine')
    assert.deepEqual((await pinnedIn(mine.lineId)).map(row => row.id), [mine.id])
    assert.equal((await listRecipes(sql, 'user_b')).length, 0)
  })

  test('a parent that does not exist is not a new recipe', async () => {
    const absent = '6f1e9b3c-0000-4000-8000-000000000000'
    assert.equal(await updateRecipe(sql, 'user_a', absent, recipe('Nothing')), null)
    assert.equal(await insertProgression(db, 'user_a', absent, recipe('Nothing')), null)
    assert.equal(await insertVariant(db, 'user_a', absent, recipe('Nothing')), null)
  })

  test('two progressions at once leave exactly one pin', async () => {
    const root = await insertRecipe(db, 'user_a', recipe('Race'))
    const results = await Promise.allSettled([
      insertProgression(db, 'user_a', root.id, recipe('Race, left')),
      insertProgression(db, 'user_a', root.id, recipe('Race, right')),
    ])
    // Whether both get through or the index stops one, the invariant holds.
    assert.equal((await pinnedIn(root.lineId)).length, 1)
    for (const result of results) {
      if (result.status === 'rejected') assert.equal((result.reason as { statusCode: number }).statusCode, 409)
    }
  })

  const exists = async (id: string) => (await findRecipe(sql, 'user_a', id)) !== null

  test('deleting the pinned leaf hands the pin back to its parent', async () => {
    const root = await insertRecipe(db, 'user_a', recipe('Ragu'))
    const second = await insertProgression(db, 'user_a', root.id, recipe('Ragu, longer'))
    const deletion = await deleteRecipe(sql, 'user_a', second!.id)
    assert.deepEqual(deletion, { count: 1, ids: [second!.id], pinned: root.id, photos: 0 })
    assert.deepEqual((await pinnedIn(root.lineId)).map(row => row.id), [root.id])
  })

  test('a deletion takes its progressions and spares its variants', async () => {
    const root = await insertRecipe(db, 'user_a', recipe('Curry'))
    const second = await insertProgression(db, 'user_a', root.id, recipe('Curry, hotter'))
    const variant = await insertVariant(db, 'user_a', second!.id, recipe('Curry, vegetable'))
    const third = await insertProgression(db, 'user_a', second!.id, recipe('Curry, hotter still'))
    const fourth = await insertProgression(db, 'user_a', third!.id, recipe('Curry, hottest'))

    const deletion = await deleteRecipe(sql, 'user_a', second!.id)
    assert.equal(deletion!.count, 3)
    assert.deepEqual(new Set(deletion!.ids), new Set([second!.id, third!.id, fourth!.id]))
    // The pin was two levels below what was deleted, and still lands on the
    // one version above it.
    assert.equal(deletion!.pinned, root.id)
    assert.deepEqual((await pinnedIn(root.lineId)).map(row => row.id), [root.id])
    for (const gone of deletion!.ids) assert.equal(await exists(gone), false)

    const survivor = await findRecipe(sql, 'user_a', variant!.id)
    assert.equal(survivor!.variantOf, null)
    assert.equal(survivor!.pinned, true)
  })

  test('deleting a branch the pin is not on leaves the pin where it is', async () => {
    const root = await insertRecipe(db, 'user_a', recipe('Soup'))
    const abandoned = await insertProgression(db, 'user_a', root.id, recipe('Soup, thin'))
    const kept = await insertProgression(db, 'user_a', root.id, recipe('Soup, thick'))
    const deletion = await deleteRecipe(sql, 'user_a', abandoned!.id)
    assert.deepEqual(deletion, { count: 1, ids: [abandoned!.id], pinned: kept!.id, photos: 0 })
    assert.deepEqual((await pinnedIn(root.lineId)).map(row => row.id), [kept!.id])
  })

  test('deleting a root ends its line', async () => {
    const root = await insertRecipe(db, 'user_a', recipe('Bread'))
    const second = await insertProgression(db, 'user_a', root.id, recipe('Bread, rye'))
    const variant = await insertVariant(db, 'user_a', root.id, recipe('Bread, sourdough'))
    const deletion = await deleteRecipe(sql, 'user_a', root.id)
    assert.equal(deletion!.count, 2)
    assert.equal(deletion!.pinned, null)
    assert.equal((await pinnedIn(root.lineId)).length, 0)
    assert.equal(await exists(second!.id), false)
    assert.equal((await findRecipe(sql, 'user_a', variant!.id))!.variantOf, null)

    const alone = await insertRecipe(db, 'user_a', recipe('Toast'))
    assert.deepEqual(await deleteRecipe(sql, 'user_a', alone.id), { count: 1, ids: [alone.id], pinned: null, photos: 0 })
  })

  test('a dry run counts what a deletion would take, and takes nothing', async () => {
    const root = await insertRecipe(db, 'user_a', recipe('Salsa'))
    const second = await insertProgression(db, 'user_a', root.id, recipe('Salsa, smoky'))
    await insertProgression(db, 'user_a', second!.id, recipe('Salsa, smokier'))

    const preview = await deleteRecipe(sql, 'user_a', second!.id, { dryRun: true })
    assert.equal(preview!.count, 2)
    assert.equal(preview!.pinned, root.id)
    for (const id of preview!.ids) assert.equal(await exists(id), true)
    assert.equal((await pinnedIn(root.lineId)).length, 1)

    const deletion = await deleteRecipe(sql, 'user_a', second!.id)
    assert.deepEqual(new Set(deletion!.ids), new Set(preview!.ids))
    assert.equal(deletion!.pinned, preview!.pinned)
  })

  test('another owner\'s recipe cannot be deleted or counted', async () => {
    const mine = await insertRecipe(db, 'user_a', recipe('Not yours'))
    assert.equal(await deleteRecipe(sql, 'user_b', mine.id, { dryRun: true }), null)
    assert.equal(await deleteRecipe(sql, 'user_b', mine.id), null)
    assert.equal(await exists(mine.id), true)
    assert.equal(await deleteRecipe(sql, 'user_a', '6f1e9b3c-0000-4000-8000-000000000000'), null)
  })

  test('a deletion and a progression at once leave exactly one pin', async () => {
    const root = await insertRecipe(db, 'user_a', recipe('Race again'))
    const second = await insertProgression(db, 'user_a', root.id, recipe('Race again, 2'))
    await Promise.allSettled([
      deleteRecipe(sql, 'user_a', second!.id),
      insertProgression(db, 'user_a', root.id, recipe('Race again, 3')),
    ])
    assert.equal((await pinnedIn(root.lineId)).length, 1)
  })

  test('a history is the whole line, from any version in it, oldest first', async () => {
    const root = await insertRecipe(db, 'user_a', recipe('Bread'))
    const second = await insertProgression(db, 'user_a', root.id, recipe('Bread, wetter'))
    // Two progressions off the second: the tree branches.
    const third = await insertProgression(db, 'user_a', second!.id, recipe('Bread, rye'))
    const fourth = await insertProgression(db, 'user_a', second!.id, recipe('Bread, spelt'))

    for (const from of [root.id, third!.id, fourth!.id]) {
      const history = await readHistory(sql, 'user_a', from)
      assert.equal(history!.lineId, root.lineId)
      assert.deepEqual(history!.versions.map(version => version.id), [root.id, second!.id, third!.id, fourth!.id])
    }
    const history = await readHistory(sql, 'user_a', root.id)
    assert.deepEqual(history!.versions.map(version => version.progressionOf), [null, root.id, second!.id, second!.id])
    assert.deepEqual(history!.versions.map(version => version.pinned), [false, false, false, true])
    // Card fields, not recipes.
    assert.deepEqual(Object.keys(history!.versions[0]!).sort(), ['changes', 'createdAt', 'id', 'ingredientCount', 'pinned', 'progressionOf', 'stepCount', 'title', 'updatedAt'])
    assert.equal(history!.versions[0]!.ingredientCount, 1)
    // Each is counted against the original; the original against nothing.
    // These differ from it by title alone.
    assert.equal(history!.versions[0]!.changes, null)
    for (const version of history!.versions.slice(1)) {
      assert.deepEqual(version.changes, {
        title: true, portions: null, totalTime: null,
        ingredients: { added: 0, removed: 0, changed: 0, items: [] },
        steps: { added: 0, removed: 0, changed: 0, items: [] },
      })
    }
    assert.deepEqual(history!.variants, [])
    assert.equal(history!.origin, null)
  })

  test('a variant is in the history by its entry point, and knows where it came from', async () => {
    const root = await insertRecipe(db, 'user_a', recipe('Curry'))
    const second = await insertProgression(db, 'user_a', root.id, recipe('Curry, hotter'))
    const variant = await insertVariant(db, 'user_a', root.id, recipe('Curry, vegan'))
    // The variant's own line moves on; the history it is reached from shows
    // where it stands now, and none of the way there.
    const variantNext = await insertProgression(db, 'user_a', variant!.id, recipe('Curry, vegan, with tofu'))

    const history = await readHistory(sql, 'user_a', second!.id)
    assert.deepEqual(history!.versions.map(version => version.id), [root.id, second!.id])
    assert.deepEqual(history!.variants.map(branch => [branch.id, branch.title, branch.variantOf]), [[variantNext!.id, 'Curry, vegan, with tofu', root.id]])

    const own = await readHistory(sql, 'user_a', variantNext!.id)
    assert.deepEqual(own!.versions.map(version => version.id), [variant!.id, variantNext!.id])
    assert.deepEqual(own!.origin, { id: root.id, title: 'Curry' })
  })

  test('a variant whose origin was deleted has a history with no origin', async () => {
    const root = await insertRecipe(db, 'user_a', recipe('Soup'))
    const variant = await insertVariant(db, 'user_a', root.id, recipe('Soup, cold'))
    await deleteRecipe(sql, 'user_a', root.id)
    const history = await readHistory(sql, 'user_a', variant!.id)
    assert.deepEqual(history!.versions.map(version => version.id), [variant!.id])
    assert.equal(history!.origin, null)
  })

  test("another owner's history is absent", async () => {
    const mine = await insertRecipe(db, 'user_a', recipe('Private'))
    assert.equal(await readHistory(sql, 'user_b', mine.id), null)
    assert.equal(await readHistory(sql, 'user_a', '6f1e9b3c-0000-4000-8000-000000000000'), null)
  })

  test('pinning moves the pin to any version in the line, and only there', async () => {
    const root = await insertRecipe(db, 'user_a', recipe('Risotto'))
    const second = await insertProgression(db, 'user_a', root.id, recipe('Risotto, lemon'))
    const variant = await insertVariant(db, 'user_a', second!.id, recipe('Risotto, barley'))
    assert.deepEqual(await pinRecipe(sql, 'user_a', root.id), { pinned: root.id, lineId: root.lineId })
    assert.deepEqual((await pinnedIn(root.lineId)).map(row => row.id), [root.id])
    // A variant's line keeps its own pin.
    assert.deepEqual((await pinnedIn(variant!.lineId)).map(row => row.id), [variant!.id])
    // Pinning what is pinned changes nothing.
    assert.deepEqual(await pinRecipe(sql, 'user_a', root.id), { pinned: root.id, lineId: root.lineId })
    assert.deepEqual((await pinnedIn(root.lineId)).map(row => row.id), [root.id])
    // And the listing follows it.
    const listed = (await listRecipes(sql, 'user_a')).map(entry => entry.id)
    assert.ok(listed.includes(root.id) && !listed.includes(second!.id))
  })

  test("another owner's version cannot be pinned", async () => {
    const root = await insertRecipe(db, 'user_a', recipe('Gnocchi'))
    const second = await insertProgression(db, 'user_a', root.id, recipe('Gnocchi, ricotta'))
    assert.equal(await pinRecipe(sql, 'user_b', root.id), null)
    assert.deepEqual((await pinnedIn(root.lineId)).map(row => row.id), [second!.id])
  })

  test('two pins at once leave exactly one', async () => {
    const root = await insertRecipe(db, 'user_a', recipe('Pin race'))
    const second = await insertProgression(db, 'user_a', root.id, recipe('Pin race, 2'))
    const third = await insertProgression(db, 'user_a', root.id, recipe('Pin race, 3'))
    const results = await Promise.allSettled([
      pinRecipe(sql, 'user_a', root.id),
      pinRecipe(sql, 'user_a', second!.id),
      insertProgression(db, 'user_a', third!.id, recipe('Pin race, 4')),
    ])
    // Pins lock the line, so neither of them loses to the other. A
    // progression does not take that lock, and may lose to either as it loses
    // to another progression: with a 409 that says to retry, never a second pin.
    assert.deepEqual(results.slice(0, 2).map(result => result.status), ['fulfilled', 'fulfilled'])
    const progression = results[2]!
    if (progression.status === 'rejected') assert.equal(progression.reason.statusCode, 409)
    assert.equal((await pinnedIn(root.lineId)).length, 1)
  })
})

// What 002_collections.sql refuses and what it does on its own. Most of it is
// about the version a membership names: that it stays that version whatever
// the pin does, that it has to be the collection owner's, and that it goes
// when the version does.
describe('collections schema', { skip: url ? false : 'NUXT_DATABASE_URL is not set' }, () => {
  const SCHEMA = 'collections_check'
  let admin: Sql
  let sql: Sql
  let db: Kysely<Database>

  before(async () => {
    admin = postgres(url!, { max: 1, onnotice: () => {} })
    await admin`DROP SCHEMA IF EXISTS ${admin(SCHEMA)} CASCADE`
    await admin`CREATE SCHEMA ${admin(SCHEMA)}`
    sql = postgres(url!, { max: 5, onnotice: () => {}, connection: { search_path: SCHEMA } })
    db = new Kysely<Database>({ dialect: new PostgresJSDialect({ postgres: sql }) })
    // Every one of them: the recipes written here are written by the store,
    // which reads a line's tags back with them.
    assert.deepEqual(await applyMigrations(sql, migrations(...STORE)), STORE)
  })

  after(async () => {
    await sql?.end()
    await admin`DROP SCHEMA IF EXISTS ${admin(SCHEMA)} CASCADE`
    await admin?.end()
  })

  const recipe = (title: string) => normalizeRecipe(parseExtraction({
    title,
    source_lang: 'en',
    ingredients: [{ originalText: 'bread', name: 'bread' }],
    steps: ['Toast it.'],
  }, { type: 'text', originalText: title }))

  const collection = async (owner: string, name: string) =>
    (await sql<{ id: string }[]>`INSERT INTO collections (owner_sub, name) VALUES (${owner}, ${name}) RETURNING id`)[0]!.id
  const add = (collectionId: string, recipeId: string, position: number, owner = 'user_a') =>
    sql`INSERT INTO collection_recipes (collection_id, recipe_id, owner_sub, position) VALUES (${collectionId}, ${recipeId}, ${owner}, ${position})`
  const members = async (collectionId: string) =>
    (await sql<{ recipe_id: string }[]>`SELECT recipe_id FROM collection_recipes WHERE collection_id = ${collectionId} ORDER BY position`).map(row => row.recipe_id)
  const refuses = (query: () => Promise<unknown>, pattern: RegExp) => assert.rejects(query, pattern)

  test('a name is one trimmed line of at most 80 characters', async () => {
    for (const name of ['', ' Weeknight', 'Weeknight ', '\tWeeknight', 'Week\nnight', 'x'.repeat(81)])
      await refuses(() => collection('user_a', name), /check/i)
    await collection('user_a', 'x'.repeat(80))
  })

  test('names are unique per owner, whatever their case', async () => {
    await collection('user_a', 'Weeknight')
    await refuses(() => collection('user_a', 'WEEKNIGHT'), /collections_owner_name_idx/)
    // Someone else's "Weeknight" is theirs.
    await collection('user_b', 'Weeknight')
  })

  test('updated_at moves on rename', async () => {
    const id = await collection('user_a', 'Renamed')
    const [before] = await sql<{ updated_at: Date }[]>`SELECT updated_at FROM collections WHERE id = ${id}`
    await sql`UPDATE collections SET name = 'Renamed again' WHERE id = ${id}`
    const [after] = await sql<{ updated_at: Date }[]>`SELECT updated_at FROM collections WHERE id = ${id}`
    assert.ok(after!.updated_at.getTime() > before!.updated_at.getTime(), 'updated_at did not move')
  })

  test('a recipe can be in several collections, and once in each', async () => {
    const bread = await insertRecipe(db, 'user_a', recipe('Bread'))
    const [one, two] = [await collection('user_a', 'One'), await collection('user_a', 'Two')]
    await add(one, bread.id, 0)
    await add(two, bread.id, 0)
    await refuses(() => add(one, bread.id, 1), /collection_recipes_pkey/)
  })

  test('a progression goes in as itself, and stays when the pin moves on', async () => {
    const root = await insertRecipe(db, 'user_a', recipe('Soup'))
    const later = await insertProgression(db, 'user_a', root.id, recipe('Soup, again'))
    const id = await collection('user_a', 'Soups')
    await add(id, later!.id, 0)
    // A newer progression takes the pin; the collection keeps the one it had.
    await insertProgression(db, 'user_a', later!.id, recipe('Soup, a third time'))
    assert.deepEqual(await members(id), [later!.id])
    // And another version of the same line can sit beside it.
    await add(id, root.id, 1)
    assert.deepEqual(await members(id), [later!.id, root.id])
  })

  test('a collection cannot hold someone else\'s recipe', async () => {
    const theirs = await insertRecipe(db, 'user_b', recipe('Theirs'))
    const mine = await collection('user_a', 'Borrowed')
    await refuses(() => add(mine, theirs.id, 0, 'user_a'), /foreign key/i)
    // Nor can a membership claim to be theirs to get past that.
    await refuses(() => add(mine, theirs.id, 0, 'user_b'), /foreign key/i)
  })

  test('two recipes cannot share a place, but a reorder can swap them', async () => {
    const [a, b] = [await insertRecipe(db, 'user_a', recipe('A')), await insertRecipe(db, 'user_a', recipe('B'))]
    const id = await collection('user_a', 'Ordered')
    await add(id, a.id, 0)
    await add(id, b.id, 1)
    // Deferred to commit, so it is the commit that refuses.
    const c = await insertRecipe(db, 'user_a', recipe('C'))
    await refuses(() => add(id, c.id, 1), /collection_recipes_position_key/)
    // One row at a time, passing through a moment where both are at 0.
    await sql.begin(async (tx) => {
      await tx`UPDATE collection_recipes SET position = 0 WHERE collection_id = ${id} AND recipe_id = ${b.id}`
      await tx`UPDATE collection_recipes SET position = 1 WHERE collection_id = ${id} AND recipe_id = ${a.id}`
    })
    assert.deepEqual(await members(id), [b.id, a.id])
    const d = await insertRecipe(db, 'user_a', recipe('D'))
    await refuses(() => add(id, d.id, -1), /check/i)
  })

  test('deleting a version takes it out of its collections, and its progressions with it', async () => {
    const root = await insertRecipe(db, 'user_a', recipe('Stew'))
    const middle = await insertProgression(db, 'user_a', root.id, recipe('Stew, again'))
    const last = await insertProgression(db, 'user_a', middle!.id, recipe('Stew, a third time'))
    const [one, two] = [await collection('user_a', 'Stews'), await collection('user_a', 'Winter')]
    await add(one, root.id, 0)
    await add(one, middle!.id, 1)
    await add(two, last!.id, 0)
    // Deleting the middle takes the last along, as it always has.
    await deleteRecipe(sql, 'user_a', middle!.id)
    assert.deepEqual(await members(one), [root.id])
    assert.deepEqual(await members(two), [])
  })

  test('a variant outlives the version it branched off, in its collections too', async () => {
    const root = await insertRecipe(db, 'user_a', recipe('Curry'))
    const variant = await insertVariant(db, 'user_a', root.id, recipe('Curry, milder'))
    const id = await collection('user_a', 'Curries')
    await add(id, root.id, 0)
    await add(id, variant!.id, 1)
    await deleteRecipe(sql, 'user_a', root.id)
    assert.deepEqual(await members(id), [variant!.id])
  })

  test('deleting a collection keeps its recipes', async () => {
    const kept = await insertRecipe(db, 'user_a', recipe('Kept'))
    const id = await collection('user_a', 'Doomed')
    await add(id, kept.id, 0)
    await sql`DELETE FROM collections WHERE id = ${id}`
    assert.deepEqual(await members(id), [])
    assert.ok(await findRecipe(sql, 'user_a', kept.id), 'the recipe went with its collection')
  })

  test('a collection is read in order through the position index', async () => {
    // SET LOCAL, inside one transaction: a plain SET would land on one pooled
    // connection and the EXPLAIN might run on another. A table this small is
    // otherwise a sequential scan, which says nothing about the index.
    const plan = await sql.begin(async (tx) => {
      await tx`SET LOCAL enable_seqscan = off`
      return (await tx<{ 'QUERY PLAN': string }[]>`EXPLAIN SELECT recipe_id FROM collection_recipes WHERE collection_id = ${crypto.randomUUID()} ORDER BY position`)
        .map(row => row['QUERY PLAN']).join('\n')
    })
    assert.match(plan, /collection_recipes_position_key/, plan)
  })
})

// The collection writes and the listing in #68, minus the session and the
// HTTP envelope. Memberships are written by hand: adding and ordering is #69.
describe('collections store', { skip: url ? false : 'NUXT_DATABASE_URL is not set' }, () => {
  const SCHEMA = 'collections_store_check'
  let admin: Sql
  let sql: Sql
  let db: Kysely<Database>

  before(async () => {
    admin = postgres(url!, { max: 1, onnotice: () => {} })
    await admin`DROP SCHEMA IF EXISTS ${admin(SCHEMA)} CASCADE`
    await admin`CREATE SCHEMA ${admin(SCHEMA)}`
    sql = postgres(url!, { max: 5, onnotice: () => {}, connection: { search_path: SCHEMA } })
    db = new Kysely<Database>({ dialect: new PostgresJSDialect({ postgres: sql }) })
    await applyMigrations(sql, migrations(...STORE))
  })

  after(async () => {
    await sql?.end()
    await admin`DROP SCHEMA IF EXISTS ${admin(SCHEMA)} CASCADE`
    await admin?.end()
  })

  const recipe = (title: string, image: string | null = null) => ({
    ...normalizeRecipe(parseExtraction({
      title,
      source_lang: 'en',
      ingredients: [{ originalText: 'bread', name: 'bread' }],
      steps: ['Toast it.'],
    }, { type: 'text', originalText: title })),
    image,
  })
  const add = (collectionId: string, recipeId: string, position: number) =>
    sql`INSERT INTO collection_recipes (collection_id, recipe_id, owner_sub, position) VALUES (${collectionId}, ${recipeId}, 'user_a', ${position})`
  const status = (statusCode: number) => (error: unknown) => (error as { statusCode: number }).statusCode === statusCode

  test('a new collection is empty, and listed with a count of 0', async () => {
    const made = await createCollection(db, 'user_a', 'Weeknight')
    assert.equal(made.name, 'Weeknight')
    assert.equal(made.createdAt, made.updatedAt)
    assert.deepEqual(await listCollections(db, 'user_a'), [{ ...made, count: 0, thumbnails: [] }])
  })

  test('a second collection of the same name, in any case, is a 409', async () => {
    await assert.rejects(() => createCollection(db, 'user_a', 'WEEKNIGHT'), status(409))
    // Someone else's is theirs.
    await createCollection(db, 'user_b', 'Weeknight')
  })

  test('the listing is newest first, and only the owner\'s', async () => {
    await createCollection(db, 'user_a', 'Christmas 2026')
    assert.deepEqual((await listCollections(db, 'user_a')).map(c => c.name), ['Christmas 2026', 'Weeknight'])
    assert.deepEqual((await listCollections(db, 'user_b')).map(c => c.name), ['Weeknight'])
  })

  test('a card carries the count and the first four versions, in order', async () => {
    const id = (await createCollection(db, 'user_a', 'Soups')).id
    const soups = []
    for (const [i, title] of ['Leek', 'Tomato', 'Pea', 'Onion', 'Miso'].entries()) {
      const saved = await insertRecipe(db, 'user_a', recipe(title, i === 1 ? null : `https://example.com/${title}.jpg`))
      soups.push(saved)
      // Added in reverse, so position order and insertion order disagree.
      await add(id, saved.id, 10 - i)
    }
    const card = (await listCollections(db, 'user_a')).find(c => c.id === id)!
    assert.equal(card.count, 5)
    assert.deepEqual(card.thumbnails.map(t => t.title), ['Miso', 'Onion', 'Pea', 'Tomato'])
    // A version with no picture is still a thumbnail, for the card to fill.
    assert.equal(card.thumbnails[3]!.image, null)
    assert.equal(card.thumbnails[0]!.image, 'https://example.com/Miso.jpg')
  })

  test('a thumbnail is the version that went in, not the line\'s newest', async () => {
    const id = (await createCollection(db, 'user_a', 'Curries')).id
    const first = await insertRecipe(db, 'user_a', recipe('Curry', 'https://example.com/first.jpg'))
    await add(id, first.id, 0)
    await insertProgression(db, 'user_a', first.id, recipe('Curry, milder', 'https://example.com/second.jpg'))
    const card = (await listCollections(db, 'user_a')).find(c => c.id === id)!
    assert.deepEqual(card.thumbnails, [{ id: first.id, title: 'Curry', image: 'https://example.com/first.jpg' }])
  })

  test('a rename moves updated_at and nothing else', async () => {
    const made = await createCollection(db, 'user_a', 'Fridays')
    const renamed = await renameCollection(db, 'user_a', made.id, 'Friday nights')
    assert.equal(renamed!.name, 'Friday nights')
    assert.equal(renamed!.createdAt, made.createdAt)
    assert.ok(renamed!.updatedAt > made.updatedAt)
  })

  test('a rename can change only the case, but not take another\'s name', async () => {
    const made = await createCollection(db, 'user_a', 'brunch')
    assert.equal((await renameCollection(db, 'user_a', made.id, 'Brunch'))!.name, 'Brunch')
    await assert.rejects(() => renameCollection(db, 'user_a', made.id, 'weeknight'), status(409))
  })

  test('someone else\'s collection cannot be renamed or deleted, and says nothing about itself', async () => {
    const theirs = (await listCollections(db, 'user_b'))[0]!
    assert.equal(await renameCollection(db, 'user_a', theirs.id, 'Mine now'), null)
    assert.equal(await deleteCollection(db, 'user_a', theirs.id), false)
    assert.equal((await listCollections(db, 'user_b'))[0]!.name, 'Weeknight')
  })

  test('deleting a collection keeps every recipe that was in it', async () => {
    const id = (await createCollection(db, 'user_a', 'Doomed')).id
    const kept = await insertRecipe(db, 'user_a', recipe('Kept'))
    await add(id, kept.id, 0)
    assert.equal(await deleteCollection(db, 'user_a', id), true)
    assert.equal(await deleteCollection(db, 'user_a', id), false)
    assert.ok(await findRecipe(sql, 'user_a', kept.id))
    assert.equal((await listCollections(db, 'user_a')).some(c => c.id === id), false)
  })
})

// Adding, removing and ordering in #69, and reading a collection back.
describe('collection membership', { skip: url ? false : 'NUXT_DATABASE_URL is not set' }, () => {
  const SCHEMA = 'collection_membership_check'
  let admin: Sql
  let sql: Sql
  let db: Kysely<Database>

  before(async () => {
    admin = postgres(url!, { max: 1, onnotice: () => {} })
    await admin`DROP SCHEMA IF EXISTS ${admin(SCHEMA)} CASCADE`
    await admin`CREATE SCHEMA ${admin(SCHEMA)}`
    sql = postgres(url!, { max: 10, onnotice: () => {}, connection: { search_path: SCHEMA } })
    db = new Kysely<Database>({ dialect: new PostgresJSDialect({ postgres: sql }) })
    await applyMigrations(sql, migrations(...STORE))
  })

  after(async () => {
    await sql?.end()
    await admin`DROP SCHEMA IF EXISTS ${admin(SCHEMA)} CASCADE`
    await admin?.end()
  })

  const recipe = (title: string) => normalizeRecipe(parseExtraction({
    title,
    source_lang: 'en',
    portions: 2,
    ingredients: [{ originalText: 'bread', name: 'bread' }, { originalText: 'butter', name: 'butter' }],
    steps: ['Toast it.'],
  }, { type: 'text', originalText: title }))
  const status = (statusCode: number) => (error: unknown) => (error as { statusCode: number }).statusCode === statusCode
  const titles = async (id: string) => (await readCollection(db, 'user_a', id))!.recipes.map(entry => entry.title)

  test('added versions go on the end, and come back as cards', async () => {
    const id = (await createCollection(db, 'user_a', 'Breakfast')).id
    const [toast, eggs] = [await insertRecipe(db, 'user_a', recipe('Toast')), await insertRecipe(db, 'user_a', recipe('Eggs'))]
    assert.equal(await addToCollection(db, 'user_a', id, toast.id), 'added')
    assert.equal(await addToCollection(db, 'user_a', id, eggs.id), 'added')
    const opened = await readCollection(db, 'user_a', id)
    assert.equal(opened!.name, 'Breakfast')
    assert.deepEqual(opened!.recipes.map(entry => entry.title), ['Toast', 'Eggs'])
    // The listing's card, whole, plus where the line stands. Only the listing
    // says whether a version is in a collection (#128): inside one, it is.
    const [first] = opened!.recipes
    const listed = await listRecipes(sql, 'user_a')
    const { inCollection, ...card } = listed.find(card => card.id === toast.id)!
    assert.equal(inCollection, true)
    assert.deepEqual(first, { ...card, pinned: true, pinnedId: toast.id })
    assert.equal(first!.ingredientCount, 2)
    // And a version in none says so.
    const loose = await insertRecipe(db, 'user_a', recipe('Porridge'))
    assert.equal((await listRecipes(sql, 'user_a')).find(card => card.id === loose.id)!.inCollection, false)
  })

  test('adding twice changes nothing', async () => {
    const id = (await createCollection(db, 'user_a', 'Twice')).id
    const [a, b] = [await insertRecipe(db, 'user_a', recipe('A')), await insertRecipe(db, 'user_a', recipe('B'))]
    await addToCollection(db, 'user_a', id, a.id)
    await addToCollection(db, 'user_a', id, b.id)
    assert.equal(await addToCollection(db, 'user_a', id, a.id), 'present')
    assert.deepEqual(await titles(id), ['A', 'B'])
  })

  test('an earlier version stays itself, and says which is newer', async () => {
    const id = (await createCollection(db, 'user_a', 'Curries')).id
    const first = await insertRecipe(db, 'user_a', recipe('Curry'))
    await addToCollection(db, 'user_a', id, first.id)
    const later = await insertProgression(db, 'user_a', first.id, recipe('Curry, milder'))
    // And the newer one can sit beside it.
    await addToCollection(db, 'user_a', id, later!.id)
    const [old, current] = (await readCollection(db, 'user_a', id))!.recipes
    assert.deepEqual([old!.title, old!.pinned, old!.pinnedId], ['Curry', false, later!.id])
    assert.deepEqual([current!.title, current!.pinned, current!.pinnedId], ['Curry, milder', true, later!.id])
  })

  test('someone else\'s recipe, or collection, is not found', async () => {
    const mine = (await createCollection(db, 'user_a', 'Mine')).id
    const theirs = await insertRecipe(db, 'user_b', recipe('Theirs'))
    const theirCollection = (await createCollection(db, 'user_b', 'Theirs')).id
    const toast = await insertRecipe(db, 'user_a', recipe('Mine'))
    // Their recipe fails at the foreign key, and says so as a missing recipe.
    assert.equal(await addToCollection(db, 'user_a', mine, theirs.id), 'recipe')
    assert.equal(await addToCollection(db, 'user_a', mine, crypto.randomUUID()), 'recipe')
    assert.equal(await addToCollection(db, 'user_a', theirCollection, toast.id), 'collection')
    assert.equal(await readCollection(db, 'user_a', theirCollection), null)
    assert.equal(await removeFromCollection(db, 'user_a', theirCollection, toast.id), false)
    assert.equal(await reorderCollection(db, 'user_a', theirCollection, []), null)
    assert.deepEqual(await titles(mine), [])
  })

  test('two adds at once take two places, not one', async () => {
    const id = (await createCollection(db, 'user_a', 'Racing')).id
    const saved = await Promise.all(['One', 'Two', 'Three', 'Four'].map(title => insertRecipe(db, 'user_a', recipe(title))))
    const results = await Promise.all(saved.map(each => addToCollection(db, 'user_a', id, each.id)))
    assert.deepEqual(results, ['added', 'added', 'added', 'added'])
    const positions = (await sql<{ position: number }[]>`SELECT position FROM collection_recipes WHERE collection_id = ${id} ORDER BY position`).map(row => row.position)
    assert.deepEqual(positions, [0, 1, 2, 3])
  })

  test('removing leaves the recipe, and removing twice is fine', async () => {
    const id = (await createCollection(db, 'user_a', 'Removing')).id
    const [a, b] = [await insertRecipe(db, 'user_a', recipe('Stays')), await insertRecipe(db, 'user_a', recipe('Goes'))]
    await addToCollection(db, 'user_a', id, a.id)
    await addToCollection(db, 'user_a', id, b.id)
    assert.equal(await removeFromCollection(db, 'user_a', id, b.id), true)
    assert.equal(await removeFromCollection(db, 'user_a', id, b.id), true)
    assert.deepEqual(await titles(id), ['Stays'])
    assert.ok(await findRecipe(sql, 'user_a', b.id))
    // The gap it left does not stop the next one going on the end.
    await addToCollection(db, 'user_a', id, b.id)
    assert.deepEqual(await titles(id), ['Stays', 'Goes'])
  })

  test('a reorder applies the whole order, and anything else is a 409 that changes nothing', async () => {
    const id = (await createCollection(db, 'user_a', 'Ordering')).id
    const [a, b, c] = await Promise.all(['A', 'B', 'C'].map(title => insertRecipe(db, 'user_a', recipe(title))))
    for (const each of [a, b, c]) await addToCollection(db, 'user_a', id, each!.id)
    const reordered = await reorderCollection(db, 'user_a', id, [c!.id, a!.id, b!.id])
    assert.deepEqual(reordered!.recipes.map(entry => entry.title), ['C', 'A', 'B'])
    // Missing one, one too many, or one that is not a member.
    for (const order of [[c!.id, a!.id], [c!.id, a!.id, b!.id, crypto.randomUUID()], [c!.id, a!.id, crypto.randomUUID()]])
      await assert.rejects(() => reorderCollection(db, 'user_a', id, order), status(409))
    assert.deepEqual(await titles(id), ['C', 'A', 'B'])
  })

  test('which collections a version is in, and only for its owner', async () => {
    const [one, two] = [(await createCollection(db, 'user_a', 'Picker one')).id, (await createCollection(db, 'user_a', 'Picker two')).id]
    const toast = await insertRecipe(db, 'user_a', recipe('Picked'))
    assert.deepEqual(await collectionsContaining(db, 'user_a', toast.id), [])
    await addToCollection(db, 'user_a', one, toast.id)
    await addToCollection(db, 'user_a', two, toast.id)
    assert.deepEqual((await collectionsContaining(db, 'user_a', toast.id))!.sort(), [one, two].sort())
    assert.equal(await collectionsContaining(db, 'user_b', toast.id), null)
    assert.equal(await collectionsContaining(db, 'user_a', crypto.randomUUID()), null)
  })
})

// Tags (#13): what 003_tags.sql refuses, and what setting a line's tags does
// to every version of it, to its variants, and to the owner's list.
describe('tags', { skip: url ? false : 'NUXT_DATABASE_URL is not set' }, () => {
  const SCHEMA = 'tags_check'
  let admin: Sql
  let sql: Sql
  let db: Kysely<Database>

  before(async () => {
    admin = postgres(url!, { max: 1, onnotice: () => {} })
    await admin`DROP SCHEMA IF EXISTS ${admin(SCHEMA)} CASCADE`
    await admin`CREATE SCHEMA ${admin(SCHEMA)}`
    sql = postgres(url!, { max: 10, onnotice: () => {}, connection: { search_path: SCHEMA } })
    db = new Kysely<Database>({ dialect: new PostgresJSDialect({ postgres: sql }) })
    await applyMigrations(sql, migrations(...STORE))
  })

  after(async () => {
    await sql?.end()
    await admin`DROP SCHEMA IF EXISTS ${admin(SCHEMA)} CASCADE`
    await admin?.end()
  })

  const recipe = (title: string) => normalizeRecipe(parseExtraction({
    title,
    source_lang: 'en',
    portions: 2,
    totalTime: 25,
    ingredients: [{ originalText: '200 g flour', quantity: '200 g', name: 'flour' }],
    steps: ['Mix the 200 g flour in.'],
  }, { type: 'text', originalText: title }))

  const refuses = (write: () => Promise<unknown>, pattern: RegExp) =>
    assert.rejects(write, (error: Error) => pattern.test(`${error.message} ${(error as { constraint_name?: string }).constraint_name ?? ''}`))

  test('a tag name is one tidy line of at most 40 characters', async () => {
    for (const name of ['', ' quick', 'quick ', 'quick  dinner', 'qu\u0000ick', 'x'.repeat(41)])
      await refuses(() => sql`INSERT INTO tags (owner_sub, name) VALUES ('user_a', ${name})`, /check|invalid byte/i)
    await sql`INSERT INTO tags (owner_sub, name) VALUES ('user_a', ${'x'.repeat(40)})`
  })

  test('a tag is unique per owner whatever its case, and only per owner', async () => {
    await sql`INSERT INTO tags (owner_sub, name) VALUES ('user_a', 'Vegan')`
    await refuses(() => sql`INSERT INTO tags (owner_sub, name) VALUES ('user_a', 'VEGAN')`, /tags_owner_name_idx/)
    await sql`INSERT INTO tags (owner_sub, name) VALUES ('user_b', 'vegan')`
  })

  test("a line cannot wear someone else's tag", async () => {
    const mine = await insertRecipe(db, 'user_a', recipe('Mine'))
    const [theirs] = await sql<{ id: string }[]>`INSERT INTO tags (owner_sub, name) VALUES ('user_b', 'Theirs') RETURNING id`
    for (const owner of ['user_a', 'user_b'])
      await refuses(() => sql`INSERT INTO recipe_tags (line_id, tag_id, owner_sub) VALUES (${mine.id}, ${theirs!.id}, ${owner})`, /foreign key/i)
  })

  test('setting tags makes the set, A to Z, and a name already had keeps its first case', async () => {
    const bread = await insertRecipe(db, 'user_a', recipe('Bread'))
    assert.deepEqual(await setTags(db, 'user_a', bread.id, ['weekend', 'Baking']), ['Baking', 'weekend'])
    const rolls = await insertRecipe(db, 'user_a', recipe('Rolls'))
    assert.deepEqual(await setTags(db, 'user_a', rolls.id, ['BAKING']), ['Baking'])
    assert.equal((await sql`SELECT 1 FROM tags WHERE owner_sub = 'user_a' AND lower(name) = 'baking'`).length, 1)
    // Replacing the set drops what is not in it, and reads back from the recipe.
    assert.deepEqual(await setTags(db, 'user_a', bread.id, ['Baking']), ['Baking'])
    assert.deepEqual((await findRecipe(sql, 'user_a', bread.id))!.tags, ['Baking'])
    assert.deepEqual(await setTags(db, 'user_a', bread.id, []), [])
    assert.deepEqual((await findRecipe(sql, 'user_a', bread.id))!.tags, [])
  })

  test('every version of a line wears its tags, and a new progression joins them', async () => {
    const root = await insertRecipe(db, 'user_a', recipe('Stew'))
    const later = await insertProgression(db, 'user_a', root.id, recipe('Stew, again'))
    // Set through the later version; read through the root.
    await setTags(db, 'user_a', later!.id, ['Winter'])
    assert.deepEqual((await findRecipe(sql, 'user_a', root.id))!.tags, ['Winter'])
    const third = await insertProgression(db, 'user_a', root.id, recipe('Stew, a third time'))
    assert.deepEqual(third!.tags, ['Winter'])
    const saved = await updateRecipe(sql, 'user_a', third!.id, recipe('Stew, corrected'))
    assert.deepEqual(saved!.tags, ['Winter'])
    // Pinning an earlier version is still the same dish.
    await pinRecipe(sql, 'user_a', root.id)
    assert.deepEqual((await listRecipes(sql, 'user_a')).find(entry => entry.id === root.id)!.tags, ['Winter'])
  })

  test('a variant starts with a copy of its tags, and they are its own after', async () => {
    const root = await insertRecipe(db, 'user_a', recipe('Curry'))
    await setTags(db, 'user_a', root.id, ['Spicy', 'Dinner'])
    const milder = await insertVariant(db, 'user_a', root.id, recipe('Curry, milder'))
    assert.deepEqual(milder!.tags, ['Dinner', 'Spicy'])
    await setTags(db, 'user_a', milder!.id, ['Dinner', 'Mild'])
    assert.deepEqual((await findRecipe(sql, 'user_a', root.id))!.tags, ['Dinner', 'Spicy'])
    // A variant of an untagged line starts with none.
    const plain = await insertRecipe(db, 'user_a', recipe('Plain'))
    assert.deepEqual((await insertVariant(db, 'user_a', plain.id, recipe('Plain, too')))!.tags, [])
  })

  test("another owner's recipe cannot be tagged, and neither can one that does not exist", async () => {
    const mine = await insertRecipe(db, 'user_a', recipe('Private'))
    assert.equal(await setTags(db, 'user_b', mine.id, ['Stolen']), null)
    assert.equal(await setTags(db, 'user_a', crypto.randomUUID(), ['Nowhere']), null)
    assert.deepEqual((await findRecipe(sql, 'user_a', mine.id))!.tags, [])
    assert.equal((await sql`SELECT 1 FROM tags WHERE lower(name) IN ('stolen', 'nowhere')`).length, 0)
  })

  test("the list is the tags in use, with how many wear each, and only the owner's", async () => {
    const tagged = await insertRecipe(db, 'user_c', recipe('Soup'))
    const other = await insertRecipe(db, 'user_c', recipe('Salad'))
    await setTags(db, 'user_c', tagged.id, ['quick', 'Lunch'])
    await setTags(db, 'user_c', other.id, ['Quick', 'zesty'])
    assert.deepEqual(await listTags(db, 'user_c'), [{ name: 'Lunch', count: 1 }, { name: 'quick', count: 2 }, { name: 'zesty', count: 1 }])
    // A tag nobody wears any more is not offered.
    await setTags(db, 'user_c', other.id, ['quick'])
    assert.deepEqual((await listTags(db, 'user_c')).map(tag => tag.name), ['Lunch', 'quick'])
    // Deleting a line takes its tags off with it.
    await deleteRecipe(sql, 'user_c', tagged.id)
    assert.deepEqual(await listTags(db, 'user_c'), [{ name: 'quick', count: 1 }])
    assert.deepEqual(await listTags(db, 'user_d'), [])
  })

  test("a collection entry carries its line's tags", async () => {
    const pie = await insertRecipe(db, 'user_a', recipe('Pie'))
    await setTags(db, 'user_a', pie.id, ['Dessert'])
    const id = (await createCollection(db, 'user_a', 'Puddings')).id
    await addToCollection(db, 'user_a', id, pie.id)
    assert.deepEqual((await readCollection(db, 'user_a', id))!.recipes[0]!.tags, ['Dessert'])
  })

  test('two lines taking the same new tag at once share one row', async () => {
    const [a, b] = await Promise.all(['A', 'B'].map(title => insertRecipe(db, 'user_e', recipe(title))))
    const [one, two] = await Promise.all([setTags(db, 'user_e', a!.id, ['Fresh']), setTags(db, 'user_e', b!.id, ['FRESH'])])
    assert.equal(one![0]!.toLowerCase(), 'fresh')
    assert.deepEqual(one, two)
    assert.deepEqual(await listTags(db, 'user_e'), [{ name: one![0]!, count: 2 }])
  })
})

// Filtering the listing (#14): each filter alone, all of them together, and
// the index still being the way in.
describe('recipe filters', { skip: url ? false : 'NUXT_DATABASE_URL is not set' }, () => {
  const SCHEMA = 'filters_check'
  let admin: Sql
  let sql: Sql
  let db: Kysely<Database>

  before(async () => {
    admin = postgres(url!, { max: 1, onnotice: () => {} })
    await admin`DROP SCHEMA IF EXISTS ${admin(SCHEMA)} CASCADE`
    await admin`CREATE SCHEMA ${admin(SCHEMA)}`
    sql = postgres(url!, { max: 5, onnotice: () => {}, connection: { search_path: SCHEMA } })
    db = new Kysely<Database>({ dialect: new PostgresJSDialect({ postgres: sql }) })
    await applyMigrations(sql, migrations(...STORE))

    // Oldest first, so the listing reads them back newest first.
    const add = async (title: string, { time = null as number | null, portions = 2 as number | null, ingredients = ['flour'], source = 'text' as 'text' | 'website' | 'photo', tags = [] as string[], owner = 'user_a' } = {}) => {
      const saved = await insertRecipe(db, owner, normalizeRecipe(parseExtraction({
        title,
        source_lang: 'en',
        portions,
        totalTime: time,
        ingredients: ingredients.map(name => ({ originalText: `1 ${name}`, quantity: '1', name })),
        steps: ['Cook it.'],
      }, source === 'website'
        ? { type: 'website', url: 'https://example.com/r', author: null, siteName: null, retrievedAt: '2026-09-01T00:00:00.000Z' }
        : source === 'photo'
          ? { type: 'photo', originalFilename: null }
          : { type: 'text', originalText: title })))
      if (tags.length) await setTags(db, owner, saved.id, tags)
      return saved
    }
    await add('Leek and potato soup', { time: 45, portions: 4, ingredients: ['leeks', 'potatoes', 'stock'], source: 'website', tags: ['Soup', 'Winter'] })
    await add('Quick tomato pasta', { time: 20, portions: 2, ingredients: ['spaghetti', 'Cherry tomatoes'], source: 'photo', tags: ['Weeknight'] })
    await add('Sunday roast', { time: 180, portions: 6, ingredients: ['beef', 'potatoes'], tags: ['winter', 'Weekend'] })
    await add('Tomato soup, 100% homemade', { time: null, portions: null, ingredients: ['tomatoes'], tags: ['soup'] })
    await add('Someone else’s soup', { time: 10, ingredients: ['tomatoes'], tags: ['Soup'], owner: 'user_b' })
  })

  after(async () => {
    await sql?.end()
    await admin`DROP SCHEMA IF EXISTS ${admin(SCHEMA)} CASCADE`
    await admin?.end()
  })

  const titles = async (query: Record<string, string | string[]>) => {
    const { filters, problems } = readFilters(query)
    assert.deepEqual(problems, [])
    return (await listRecipes(sql, 'user_a', filters)).map(row => row.title)
  }

  test('no filters is the whole listing, newest first', async () => {
    assert.deepEqual(await titles({}), ['Tomato soup, 100% homemade', 'Sunday roast', 'Quick tomato pasta', 'Leek and potato soup'])
  })

  test('the search finds words in the title, in any case, and only there', async () => {
    assert.deepEqual(await titles({ q: 'SOUP' }), ['Tomato soup, 100% homemade', 'Leek and potato soup'])
    assert.deepEqual(await titles({ q: 'beef' }), [])
    // What LIKE would read as a wildcard is only itself.
    assert.deepEqual(await titles({ q: '100%' }), ['Tomato soup, 100% homemade'])
    assert.deepEqual(await titles({ q: 'to_ato' }), [])
  })

  test('a line has to wear every tag asked for, in any case', async () => {
    assert.deepEqual(await titles({ tag: 'soup' }), ['Tomato soup, 100% homemade', 'Leek and potato soup'])
    assert.deepEqual(await titles({ tag: ['WINTER', 'soup'] }), ['Leek and potato soup'])
    assert.deepEqual(await titles({ tag: ['Winter', 'winter'] }), ['Sunday roast', 'Leek and potato soup'])
    assert.deepEqual(await titles({ tag: 'Nowhere' }), [])
  })

  test('an ingredient is found by part of its name, and every one asked for must be there', async () => {
    assert.deepEqual(await titles({ ingredient: 'tomato' }), ['Tomato soup, 100% homemade', 'Quick tomato pasta'])
    assert.deepEqual(await titles({ ingredient: ['potato', 'beef'] }), ['Sunday roast'])
  })

  test('time, portions and source narrow by what extraction gave', async () => {
    // A recipe that states no time is not known to be quick.
    assert.deepEqual(await titles({ maxTime: '45' }), ['Quick tomato pasta', 'Leek and potato soup'])
    assert.deepEqual(await titles({ minPortions: '4' }), ['Sunday roast', 'Leek and potato soup'])
    assert.deepEqual(await titles({ minPortions: '3', maxPortions: '4' }), ['Leek and potato soup'])
    assert.deepEqual(await titles({ source: ['photo', 'website'] }), ['Quick tomato pasta', 'Leek and potato soup'])
    assert.deepEqual(await titles({ source: 'text' }), ['Tomato soup, 100% homemade', 'Sunday roast'])
  })

  test('filters combine rather than replace each other', async () => {
    assert.deepEqual(await titles({ tag: 'winter', ingredient: 'potato' }), ['Sunday roast', 'Leek and potato soup'])
    assert.deepEqual(await titles({ tag: 'winter', ingredient: 'potato', maxTime: '60' }), ['Leek and potato soup'])
    assert.deepEqual(await titles({ tag: 'winter', ingredient: 'potato', maxTime: '60', source: 'text' }), [])
  })

  test('filtering reads the owner’s pinned rows through the listing index', async () => {
    const { filters } = readFilters({ q: 'soup', tag: ['soup', 'winter'], ingredient: 'leek', maxTime: '60', minPortions: '2', maxPortions: '6', source: 'website' })
    const plan = await sql.begin(async (tx) => {
      await tx`SET LOCAL enable_seqscan = off`
      return (await tx<{ 'QUERY PLAN': string }[]>`EXPLAIN ${listing(tx, 'user_a', filters, 200)}`)
        .map(row => row['QUERY PLAN']).join('\n')
    })
    assert.match(plan, /recipes_owner_pinned_idx/, plan)
  })
})

// Preferences (#62): one row per person, what the table refuses, and what the
// store writes and reads back.
describe('preferences', { skip: url ? false : 'NUXT_DATABASE_URL is not set' }, () => {
  const SCHEMA = 'preferences_check'
  let admin: Sql
  let sql: Sql
  let db: Kysely<Database>

  before(async () => {
    admin = postgres(url!, { max: 1, onnotice: () => {} })
    await admin`DROP SCHEMA IF EXISTS ${admin(SCHEMA)} CASCADE`
    await admin`CREATE SCHEMA ${admin(SCHEMA)}`
    sql = postgres(url!, { max: 10, onnotice: () => {}, connection: { search_path: SCHEMA } })
    db = new Kysely<Database>({ dialect: new PostgresJSDialect({ postgres: sql }) })
    await applyMigrations(sql, migrations(...STORE))
  })

  after(async () => {
    await sql?.end()
    await admin`DROP SCHEMA IF EXISTS ${admin(SCHEMA)} CASCADE`
    await admin?.end()
  })

  test('nothing saved reads as nothing set', async () => {
    assert.deepEqual(await readPreferences(db, 'nobody'), { unitSystem: null, portions: null, paperNudge: null, ingredientMatching: null, ingredientBackfill: null, theme: null, grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null, stoveKind: null, stoveLowest: null, stoveHighest: null, stoveBoost: null, stoveMediumFrom: null, stoveHighFrom: null })
  })

  test('a save replaces the whole set, per owner', async () => {
    assert.deepEqual(await writePreferences(db, 'user_a', { unitSystem: 'imperial', portions: 4, paperNudge: null, ingredientMatching: null, ingredientBackfill: null, theme: null, grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null, stoveKind: null, stoveLowest: null, stoveHighest: null, stoveBoost: null, stoveMediumFrom: null, stoveHighFrom: null }), { unitSystem: 'imperial', portions: 4, paperNudge: null, ingredientMatching: null, ingredientBackfill: null, theme: null, grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null, stoveKind: null, stoveLowest: null, stoveHighest: null, stoveBoost: null, stoveMediumFrom: null, stoveHighFrom: null })
    await writePreferences(db, 'user_b', { unitSystem: 'metric', portions: null, paperNudge: null, ingredientMatching: null, ingredientBackfill: null, theme: null, grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null, stoveKind: null, stoveLowest: null, stoveHighest: null, stoveBoost: null, stoveMediumFrom: null, stoveHighFrom: null })
    assert.deepEqual(await writePreferences(db, 'user_a', { unitSystem: null, portions: 2, paperNudge: null, ingredientMatching: null, ingredientBackfill: null, theme: null, grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null, stoveKind: null, stoveLowest: null, stoveHighest: null, stoveBoost: null, stoveMediumFrom: null, stoveHighFrom: null }), { unitSystem: null, portions: 2, paperNudge: null, ingredientMatching: null, ingredientBackfill: null, theme: null, grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null, stoveKind: null, stoveLowest: null, stoveHighest: null, stoveBoost: null, stoveMediumFrom: null, stoveHighFrom: null })
    assert.deepEqual(await readPreferences(db, 'user_a'), { unitSystem: null, portions: 2, paperNudge: null, ingredientMatching: null, ingredientBackfill: null, theme: null, grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null, stoveKind: null, stoveLowest: null, stoveHighest: null, stoveBoost: null, stoveMediumFrom: null, stoveHighFrom: null })
    assert.deepEqual(await readPreferences(db, 'user_b'), { unitSystem: 'metric', portions: null, paperNudge: null, ingredientMatching: null, ingredientBackfill: null, theme: null, grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null, stoveKind: null, stoveLowest: null, stoveHighest: null, stoveBoost: null, stoveMediumFrom: null, stoveHighFrom: null })
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM preferences WHERE owner_sub = 'user_a'`
    assert.equal(n, 1)
  })

  test('the table holds one object per owner, and nothing else', async () => {
    for (const settings of ['[]', '"metric"', '4', 'null'])
      await assert.rejects(() => sql`INSERT INTO preferences (owner_sub, settings) VALUES ('user_c', ${settings}::jsonb)`, /check|null value/i)
  })

  test('stored settings read as the config has them now', async () => {
    // A key it no longer has, and values it would not take: left out, and unset.
    await sql`INSERT INTO preferences (owner_sub, settings) VALUES ('user_d', ${{ stove: 'gas', unitSystem: 'si', portions: 4 }}::jsonb)`
    assert.deepEqual(await readPreferences(db, 'user_d'), { unitSystem: null, portions: 4, paperNudge: null, ingredientMatching: null, ingredientBackfill: null, theme: null, grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null, stoveKind: null, stoveLowest: null, stoveHighest: null, stoveBoost: null, stoveMediumFrom: null, stoveHighFrom: null })
    await writePreferences(db, 'user_d', { unitSystem: 'metric', portions: 4, paperNudge: null, ingredientMatching: null, ingredientBackfill: null, theme: null, grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null, stoveKind: null, stoveLowest: null, stoveHighest: null, stoveBoost: null, stoveMediumFrom: null, stoveHighFrom: null })
    const [{ settings }] = await sql<{ settings: unknown }[]>`SELECT settings FROM preferences WHERE owner_sub = 'user_d'`
    assert.deepEqual(settings, { unitSystem: 'metric', portions: 4, paperNudge: null, ingredientMatching: null, ingredientBackfill: null, theme: null, grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null, stoveKind: null, stoveLowest: null, stoveHighest: null, stoveBoost: null, stoveMediumFrom: null, stoveHighFrom: null })
  })
})

describe('images', { skip: url ? false : 'NUXT_DATABASE_URL is not set' }, () => {
  const SCHEMA = 'images_check'
  let admin: Sql
  let sql: Sql
  let db: Kysely<Database>

  before(async () => {
    admin = postgres(url!, { max: 1, onnotice: () => {} })
    await admin`DROP SCHEMA IF EXISTS ${admin(SCHEMA)} CASCADE`
    await admin`CREATE SCHEMA ${admin(SCHEMA)}`
    sql = postgres(url!, { max: 10, onnotice: () => {}, connection: { search_path: SCHEMA } })
    db = new Kysely<Database>({ dialect: new PostgresJSDialect({ postgres: sql }) })
    await applyMigrations(sql, migrations(...STORE))
  })

  after(async () => {
    await sql?.end()
    await admin`DROP SCHEMA IF EXISTS ${admin(SCHEMA)} CASCADE`
    await admin?.end()
  })

  const recipe = (title: string) => normalizeRecipe(parseExtraction({
    title,
    source_lang: 'en',
    portions: 2,
    totalTime: 25,
    ingredients: [{ originalText: '200 g flour', quantity: '200 g', name: 'flour' }],
    steps: ['Mix the 200 g flour in.'],
  }, { type: 'photo', originalFilename: 'page.jpg' }))

  // A JPEG as far as anything here looks: the magic bytes and a marker.
  const jpeg = (marker: number) => Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, marker])
  const upload = (marker = 1) => ({ mediaType: 'image/jpeg' as const, data: jpeg(marker), thumb: jpeg(marker + 100) })
  const ids = (photos: { photos: { id: string }[] } | null) => photos!.photos.map(photo => photo.id)
  const status = (code: number) => (error: { statusCode?: number }) => error.statusCode === code

  test('ten photos a version, the first its cover, and the eleventh refused', async () => {
    const bread = await insertRecipe(db, 'user_a', recipe('Bread'))
    let photos = await addPhoto(db, 'user_a', bread.id, upload())
    assert.deepEqual(photos!.photos.map(photo => photo.cover), [true])
    for (let n = 2; n <= 10; n++) photos = await addPhoto(db, 'user_a', bread.id, upload(n))
    assert.equal(photos!.photos.length, 10)
    assert.equal(photos!.photos.filter(photo => photo.cover).length, 1)
    await assert.rejects(() => addPhoto(db, 'user_a', bread.id, upload(11)), status(409))
    // The table holds the limit too, for a write that skipped the count.
    await assert.rejects(() => sql`
      INSERT INTO images (recipe_id, owner_sub, kind, position, media_type, data, thumb)
      VALUES (${bread.id}, 'user_a', 'dish', 10, 'image/jpeg', ${jpeg(1)}, ${jpeg(2)})
    `, /check/i)
  })

  test('the bytes read back in either size, for their owner only', async () => {
    const soup = await insertRecipe(db, 'user_a', recipe('Soup'))
    const [id] = ids(await addPhoto(db, 'user_a', soup.id, upload(7)))
    const full = await readImage(db, 'user_a', id!, 'full')
    assert.equal(full!.media_type, 'image/jpeg')
    assert.deepEqual(Buffer.from(full!.bytes), jpeg(7))
    assert.deepEqual(Buffer.from((await readImage(db, 'user_a', id!, 'thumb'))!.bytes), jpeg(107))
    assert.equal(await readImage(db, 'user_b', id!, 'full'), undefined)
    assert.equal(await listPhotos(db, 'user_b', soup.id), null)
    assert.equal(await addPhoto(db, 'user_b', soup.id, upload()), null)
    assert.equal(await deleteImage(db, 'user_b', id!), false)
  })

  test('arranging reorders and moves the cover, and a stale order is refused', async () => {
    const pie = await insertRecipe(db, 'user_a', recipe('Pie'))
    for (const n of [1, 2, 3]) await addPhoto(db, 'user_a', pie.id, upload(n))
    const [a, b, c] = ids(await listPhotos(db, 'user_a', pie.id))
    const arranged = await arrangePhotos(db, 'user_a', pie.id, [c!, a!, b!], b!)
    assert.deepEqual(arranged!.photos, [{ id: c, cover: false }, { id: a, cover: false }, { id: b, cover: true }])
    assert.deepEqual((await arrangePhotos(db, 'user_a', pie.id, [a!, b!, c!], null))!.photos.map(photo => photo.cover), [false, false, false])
    await assert.rejects(() => arrangePhotos(db, 'user_a', pie.id, [a!, b!], null), status(409))
    await assert.rejects(() => arrangePhotos(db, 'user_a', pie.id, [a!, b!, c!], crypto.randomUUID()), status(409))
  })

  test('removing a photo closes the gap, and a removed cover hands over to the first', async () => {
    const tart = await insertRecipe(db, 'user_a', recipe('Tart'))
    for (const n of [1, 2, 3]) await addPhoto(db, 'user_a', tart.id, upload(n))
    const [a, b, c] = ids(await listPhotos(db, 'user_a', tart.id))
    assert.equal(await deleteImage(db, 'user_a', a!), true)
    assert.deepEqual((await listPhotos(db, 'user_a', tart.id))!.photos, [{ id: b, cover: true }, { id: c, cover: false }])
    const positions = await sql<{ position: number }[]>`SELECT position FROM images WHERE recipe_id = ${tart.id} ORDER BY position`
    assert.deepEqual(positions.map(row => row.position), [0, 1])
    assert.equal((await addPhoto(db, 'user_a', tart.id, upload(4)))!.photos.length, 3)
  })

  test("each version keeps its own photos, and a card shows the pin's cover, else the line's newest", async () => {
    const stew = await insertRecipe(db, 'user_a', recipe('Stew'))
    const [first] = ids(await addPhoto(db, 'user_a', stew.id, upload()))
    const again = await insertProgression(db, 'user_a', stew.id, recipe('Stew, again'))
    // Its banner is the line's cover until it has one of its own (#193).
    assert.deepEqual(await listPhotos(db, 'user_a', again!.id), { photos: [], source: null, lineCover: first })
    assert.deepEqual(ids(await listPhotos(db, 'user_a', stew.id)), [first])
    const card = async () => (await listRecipes(sql, 'user_a')).find(entry => entry.lineId === stew.id)!.image
    // The pin has none yet, so the line's is shown rather than nothing.
    assert.equal(await card(), `/api/images/${first}?size=thumb`)
    const [own] = ids(await addPhoto(db, 'user_a', again!.id, upload(2)))
    assert.equal(await card(), `/api/images/${own}?size=thumb`)
    assert.equal((await listPhotos(db, 'user_a', again!.id))!.lineCover, own)
    assert.equal((await listPhotos(db, 'user_a', stew.id))!.lineCover, first)
  })

  test("the source photo is the line's, and a variant takes a copy of it and none of the dish photos", async () => {
    const card = await insertRecipe(db, 'user_a', recipe('Card'))
    const later = await insertProgression(db, 'user_a', card.id, recipe('Card, later'))
    const kept = await setSourcePhoto(db, 'user_a', later!.id, upload(5))
    assert.ok(kept!.source)
    // Set through a later version; it hangs on the root, so every version sees it.
    assert.equal((await listPhotos(db, 'user_a', card.id))!.source, kept!.source)
    // A second replaces the first under a new id.
    const replaced = await setSourcePhoto(db, 'user_a', card.id, upload(6))
    assert.notEqual(replaced!.source, kept!.source)
    assert.equal(await readImage(db, 'user_a', kept!.source!, 'full'), undefined)

    await addPhoto(db, 'user_a', later!.id, upload(8))
    const variant = await insertVariant(db, 'user_a', later!.id, recipe('Card, otherwise'))
    const theirs = await listPhotos(db, 'user_a', variant!.id)
    assert.deepEqual(theirs!.photos, [])
    assert.ok(theirs!.source && theirs!.source !== replaced!.source)
    assert.deepEqual(Buffer.from((await readImage(db, 'user_a', theirs!.source!, 'full'))!.bytes), jpeg(6))
  })

  test('deleting a version takes its photos and those of its descendants, and says how many first', async () => {
    const cake = await insertRecipe(db, 'user_a', recipe('Cake'))
    await setSourcePhoto(db, 'user_a', cake.id, upload(1))
    await addPhoto(db, 'user_a', cake.id, upload(2))
    const second = await insertProgression(db, 'user_a', cake.id, recipe('Cake 2'))
    await addPhoto(db, 'user_a', second!.id, upload(3))
    const third = await insertProgression(db, 'user_a', second!.id, recipe('Cake 3'))
    await addPhoto(db, 'user_a', third!.id, upload(4))
    await addPhoto(db, 'user_a', third!.id, upload(5))

    assert.equal((await deleteRecipe(sql, 'user_a', second!.id, { dryRun: true }))!.photos, 3)
    assert.equal((await deleteRecipe(sql, 'user_a', second!.id))!.photos, 3)
    // The root's own photo and the line's source photo stay.
    const left = await listPhotos(db, 'user_a', cake.id)
    assert.equal(left!.photos.length, 1)
    assert.ok(left!.source)
    assert.equal((await deleteRecipe(sql, 'user_a', cake.id))!.photos, 2)
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM images WHERE owner_sub = 'user_a' AND recipe_id = ${cake.id}`
    assert.equal(n, 0)
  })
})

// The ingredient store (#171) and its seed, from a few OFF entries and FDC
// portions written out here rather than the real files.
describe('ingredient store', { skip: url ? false : 'NUXT_DATABASE_URL is not set' }, () => {
  const SCHEMA = 'ingredients_check'
  let admin: Sql
  let sql: Sql

  before(async () => {
    admin = postgres(url!, { max: 1, onnotice: () => {} })
    await admin`DROP SCHEMA IF EXISTS ${admin(SCHEMA)} CASCADE`
    await admin`CREATE SCHEMA ${admin(SCHEMA)}`
    sql = postgres(url!, { max: 5, onnotice: () => {}, connection: { search_path: SCHEMA } })
    assert.deepEqual(await applyMigrations(sql, migrations('006_ingredients.sql')), ['006_ingredients.sql'])
  })

  after(async () => {
    await sql?.end()
    await admin`DROP SCHEMA IF EXISTS ${admin(SCHEMA)} CASCADE`
    await admin?.end()
  })

  const PORTIONS = [
    '"id","fdc_id","seq_num","amount","measure_unit_id","portion_description","modifier","gram_weight"',
    // Flour: the plain tablespoon wins over the cup with a modifier.
    '"1","100","1","1","9999","","cup, sifted","100"',
    '"2","100","2","1","9999","","tbsp","7.5"',
    // Sugar: cup over tablespoon, both plain; and its second FDC id has none.
    '"3","200","1","1","9999","","tbsp","12.5"',
    '"4","200","2","1","9999","","cup","200"',
    // Salt: a teaspoon at 3.6 g/ml, out of range, so no density.
    '"5","300","1","1","9999","","tsp","17.7"',
    '"6","300","2","1","9999","","serving","5"',
  ].join('\n')
  const TAXONOMY = {
    'en:flour': { synonyms: { en: ['flour', 'Flour', 'plain flour'], de: ['Mehl', 'Weizenmehl'], xx: ['farina'] }, usda_fdc_code: { en: '100' } },
    'en:sugar': { synonyms: { en: ['sugar', 'white sugar'], de: ['Zucker'] }, usda_fdc_code: { en: '200, 999' } },
    'en:salt': { synonyms: { en: ['salt', 'pepper'] }, usda_fdc_code: { en: '300' } },
    'en:black-pepper': { synonyms: { en: ['black pepper', 'pepper'], de: ['Pfeffer'] }, usda_fdc_code: { en: '400' } },
    // No FDC id: left out.
    'en:quark': { synonyms: { en: ['quark'], de: ['Quark'] } },
  }

  let report: Awaited<ReturnType<typeof seedIngredients>>
  const byOff = async (offId: string) => (await sql<{ id: string, density_g_per_ml: string | null, density_source: string | null, density_ref: string | null }[]>`
    SELECT i.* FROM ingredients i JOIN ingredient_sources s ON s.ingredient_id = i.id
    WHERE s.source = 'off' AND s.external_id = ${offId}`)[0]
  const names = async (id: string) => (await sql<{ lang: string, name: string, is_main: boolean }[]>`
    SELECT lang, name, is_main FROM ingredient_names WHERE ingredient_id = ${id} AND confirmed AND source = 'off' AND added_by IS NULL ORDER BY lang, name`)
    .map(row => `${row.lang}:${row.name}${row.is_main ? '*' : ''}`)

  test('seeds one entry per OFF entry with an FDC id, with its sources and names', async () => {
    report = await seedIngredients(sql, TAXONOMY, readPortions(PORTIONS))
    assert.equal(report.ingredients, 4)
    assert.equal(await byOff('en:quark'), undefined)
    const sugar = await byOff('en:sugar')
    const sources = await sql`SELECT source, external_id FROM ingredient_sources WHERE ingredient_id = ${sugar!.id} ORDER BY source, external_id`
    assert.deepEqual(sources.map(row => `${row.source}:${row.external_id}`), ['fdc:200', 'fdc:999', 'off:en:sugar'])
    // The first in each language is the main name; a case-only repeat is dropped.
    assert.deepEqual(await names((await byOff('en:flour'))!.id), ['de:Mehl*', 'de:Weizenmehl', 'en:flour*', 'en:plain flour', 'xx:farina*'])
  })

  test('density follows the portion rule, with the portion as its ref', async () => {
    assert.deepEqual(await byOff('en:flour').then(row => [row!.density_g_per_ml, row!.density_source, row!.density_ref]), ['0.5072', 'fdc', '2'])
    assert.deepEqual(await byOff('en:sugar').then(row => [row!.density_g_per_ml, row!.density_ref]), ['0.8454', '4'])
    assert.deepEqual(await byOff('en:salt').then(row => [row!.density_g_per_ml, row!.density_source, row!.density_ref]), [null, null, null])
    assert.equal(report.withDensity, 2)
  })

  test('a name on two entries in one language is seeded on neither, and reported', async () => {
    assert.deepEqual(report.duplicates, [{ lang: 'en', name: 'pepper', entries: ['en:salt', 'en:black-pepper'] }])
    assert.deepEqual(await names((await byOff('en:salt'))!.id), ['en:salt*'])
    assert.deepEqual(await names((await byOff('en:black-pepper'))!.id), ['de:Pfeffer*', 'en:black pepper*'])
  })

  test('the seed refuses to run again', async () => {
    await assert.rejects(() => seedIngredients(sql, TAXONOMY, readPortions(PORTIONS)), /already has entries/)
    assert.equal((await sql`SELECT count(*)::int AS n FROM ingredients`)[0]!.n, 4)
  })

  test('names are unique per language regardless of case, and found by trigram', async () => {
    const flour = (await byOff('en:flour'))!.id
    await assert.rejects(() => sql`INSERT INTO ingredient_names (ingredient_id, lang, name, confirmed, source) VALUES (${flour}, 'de', 'MEHL', true, 'cook')`, /ingredient_names_lang_name_idx/)
    await assert.rejects(() => sql`INSERT INTO ingredient_names (ingredient_id, lang, name, is_main, confirmed, source) VALUES (${flour}, 'de', 'Mehlchen', true, false, 'cook')`, /check/)
    const close = await sql`SELECT name FROM ingredient_names WHERE lower(name) OPERATOR(public.%) 'weizenmehle'`
    assert.deepEqual(close.map(row => row.name), ['Weizenmehl'])
  })

  test('a density needs its source', async () => {
    await assert.rejects(() => sql`INSERT INTO ingredients (density_g_per_ml) VALUES (1)`, /check/)
  })
})

// Matching lines against the store after save (#172): the queue the save
// trigger fills, and what a pass over a recipe leaves behind.
describe('ingredient matching', { skip: url ? false : 'NUXT_DATABASE_URL is not set' }, () => {
  const SCHEMA = 'matching_check'
  let admin: Sql
  let sql: Sql
  let db: Kysely<Database>
  const entry: Record<string, string> = {}
  let oldRecipe: string

  before(async () => {
    admin = postgres(url!, { max: 1, onnotice: () => {} })
    await admin`DROP SCHEMA IF EXISTS ${admin(SCHEMA)} CASCADE`
    await admin`CREATE SCHEMA ${admin(SCHEMA)}`
    sql = postgres(url!, { max: 10, onnotice: () => {}, connection: { search_path: SCHEMA } })
    db = new Kysely<Database>({ dialect: new PostgresJSDialect({ postgres: sql }) })
    // Up to the store, then a recipe saved before matching existed, then 007.
    await applyMigrations(sql, migrations(...STORE.slice(0, 6)))
    oldRecipe = (await insertRecipe(db, 'user_old', recipe('en', 'flour'))).id
    await applyMigrations(sql, migrations(...STORE))

    // A small store: each entry's confirmed and unconfirmed names, as lang:name.
    const store: [string, string[], string[]][] = [
      ['flour', ['en:flour', 'en:plain flour', 'de:Mehl', 'xx:farina'], []],
      ['sugar', ['en:sugar', 'de:Zucker'], []],
      ['laurel', ['en:laurel'], ['en:bay leaves']],
      ['gift', ['en:gift'], []],
      ['poison', ['de:Gift'], []],
      ['tomato', ['en:tomato'], []],
      ['tomatillo', ['en:tomatillo'], []],
    ]
    for (const [key, confirmed, unconfirmed] of store) {
      const [{ id }] = await sql<{ id: string }[]>`INSERT INTO ingredients DEFAULT VALUES RETURNING id`
      entry[key] = id
      const mains = new Set<string>()
      const rows = [...confirmed.map(n => [n, true] as const), ...unconfirmed.map(n => [n, false] as const)].map(([tagged, isConfirmed]) => {
        const [lang, name] = tagged.split(':') as [string, string]
        const is_main = isConfirmed && !mains.has(lang)
        mains.add(lang)
        return { ingredient_id: id, lang, name, is_main, confirmed: isConfirmed, source: isConfirmed ? 'off' : 'searxng' }
      })
      await sql`INSERT INTO ingredient_names ${sql(rows)}`
    }
    await sql`INSERT INTO preferences (owner_sub, settings) VALUES ('user_in', ${sql.json({ ingredientMatching: 'on' })})`
  })

  after(async () => {
    await sql?.end()
    await admin`DROP SCHEMA IF EXISTS ${admin(SCHEMA)} CASCADE`
    await admin?.end()
  })

  function recipe(lang: string, ...names: string[]) {
    return normalizeRecipe(parseExtraction({
      title: 'Test',
      source_lang: lang,
      ingredients: names.map(name => ({ originalText: name, quantity: null, name })),
      steps: ['Cook.'],
    }, { type: 'text', originalText: names.join('\n') }))
  }
  const save = async (owner: string, lang: string, ...names: string[]) => {
    const saved = await insertRecipe(db, owner, recipe(lang, ...names))
    await drainQueue(sql)
    return saved
  }
  // line id → the entry it links to, read as readers will: only while the
  // line still carries the name it was linked for.
  const links = async (recipeId: string) => Object.fromEntries((await sql<{ line_id: string, ingredient_id: string }[]>`
    SELECT l.line_id, l.ingredient_id FROM ingredient_links l
    JOIN recipes r ON r.id = l.recipe_id
    JOIN LATERAL jsonb_array_elements(r.ingredients) AS line ON line->>'id' = l.line_id AND trim(line->>'name') = l.name
    WHERE l.recipe_id = ${recipeId}`).map(row => [row.line_id, row.ingredient_id]))
  const candidates = async (recipeId: string) => [...await sql<{ line_id: string, ingredient_id: string, matched_name: string, similarity: number }[]>`
    SELECT line_id, ingredient_id, matched_name, similarity FROM ingredient_candidates WHERE recipe_id = ${recipeId}
    ORDER BY line_id, similarity DESC`]
  const queued = async () => (await sql<{ recipe_id: string }[]>`SELECT recipe_id FROM ingredient_queue`).map(row => row.recipe_id)
  const count = async (query: Promise<{ n: number }[]>) => (await query)[0]!.n

  test('recipes saved before matching are queued by the migration, and saves queue theirs', async () => {
    assert.deepEqual(await queued(), [oldRecipe])
    await drainQueue(sql)
    assert.deepEqual(await links(oldRecipe), { ingredient_1: entry.flour })
    const fresh = await insertRecipe(db, 'user_a', recipe('en', 'sugar'))
    assert.deepEqual(await queued(), [fresh.id])
    await drainQueue(sql)
    assert.deepEqual(await queued(), [])
  })

  test('languages: by primary subtag, xx names everywhere, und against all only when unambiguous', async () => {
    const german = await save('user_a', 'de-DE', 'Mehl', 'zucker')
    assert.deepEqual(await links(german.id), { ingredient_1: entry.flour, ingredient_2: entry.sugar })
    // Same food, other language: the same entry; 'farina' is every language's.
    const english = await save('user_a', 'en', 'flour', 'farina')
    assert.deepEqual(await links(english.id), { ingredient_1: entry.flour, ingredient_2: entry.flour })
    // A German name in an English recipe is no exact match.
    assert.deepEqual(await links((await save('user_a', 'en', 'Zucker')).id), {})
    // 'und' finds 'Zucker' in German; 'gift' is two entries across languages.
    const unknown = await save('user_a', 'und', 'Zucker', 'gift')
    assert.deepEqual(await links(unknown.id), { ingredient_1: entry.sugar })
  })

  test("an exact match links for every cook, and the line's text is untouched", async () => {
    const out = await save('user_out', 'en', 'Plain Flour')
    assert.deepEqual(await links(out.id), { ingredient_1: entry.flour })
    const read = (await findRecipe(sql, 'user_out', out.id))!.ingredients
    assert.deepEqual(read.map(line => line.ingredient?.id), [entry.flour])
    assert.deepEqual(read.map(line => ({ ...line, ingredient: null })), out.ingredients)
  })

  test('close matches become up to three candidates for an opted-in cook, unconfirmed names included', async () => {
    const opted = await save('user_in', 'en', 'tomatos', 'bay leaves')
    assert.deepEqual(await links(opted.id), {})
    const found = await candidates(opted.id)
    const tomatos = found.filter(c => c.line_id === 'ingredient_1')
    assert.ok(tomatos.length >= 1 && tomatos.length <= 3)
    assert.equal(tomatos[0]!.ingredient_id, entry.tomato)
    assert.ok(tomatos.every(c => c.similarity >= 0.4))
    // An unconfirmed name: a candidate at 1.0, never a link.
    assert.deepEqual(found.filter(c => c.line_id === 'ingredient_2').map(c => [c.ingredient_id, c.matched_name, c.similarity]), [[entry.laurel, 'bay leaves', 1]])
    // An opted-out cook is asked nothing.
    assert.deepEqual(await candidates((await save('user_out', 'en', 'tomatos')).id), [])
  })

  test("no match: an opted-in cook's line makes a new entry, an opted-out cook's stays unlinked", async () => {
    const id = (await links((await save('user_in', 'en', 'Szechuan pepper')).id)).ingredient_1
    assert.ok(id)
    const [made] = await sql`SELECT i.created_by, n.lang, n.name, n.is_main, n.confirmed, n.source, n.added_by
      FROM ingredients i JOIN ingredient_names n ON n.ingredient_id = i.id WHERE i.id = ${id}`
    assert.deepEqual({ ...made }, { created_by: 'user_in', lang: 'en', name: 'Szechuan pepper', is_main: true, confirmed: true, source: 'cook', added_by: 'user_in' })
    const entries = await count(sql`SELECT count(*)::int AS n FROM ingredients`)
    assert.deepEqual(await links((await save('user_out', 'en', 'grains of paradise')).id), {})
    assert.equal(await count(sql`SELECT count(*)::int AS n FROM ingredients`), entries)
    // The next cook's line links to the entry the first one made.
    assert.deepEqual(await links((await save('user_out', 'en', 'szechuan pepper')).id), { ingredient_1: id })
  })

  test('linking adds no version and leaves updated_at alone', async () => {
    const saved = await save('user_a', 'en', 'sugar')
    assert.deepEqual(await links(saved.id), { ingredient_1: entry.sugar })
    const rows = await sql`SELECT updated_at FROM recipes WHERE line_id = ${saved.lineId}`
    assert.deepEqual(rows.map(row => row.updated_at.toISOString()), [saved.updatedAt])
  })

  test('an edited or removed line loses its link and candidates, and an edited one is matched again', async () => {
    const saved = await save('user_in', 'en', 'flour', 'tomatos', 'sugar')
    assert.equal(Object.keys(await links(saved.id)).length, 2)
    assert.ok((await candidates(saved.id)).length)
    // Line 1 renamed; line 2, with its candidates, removed, so line 3 moves up.
    await updateRecipe(sql, 'user_in', saved.id, recipe('en', 'saffron threads', 'sugar'))
    // Before the pass, nothing reads as linked under the old names.
    assert.deepEqual(await links(saved.id), {})
    await drainQueue(sql)
    assert.deepEqual(await candidates(saved.id), [])
    const after = await links(saved.id)
    assert.equal(after.ingredient_2, entry.sugar)
    assert.ok(after.ingredient_1 && after.ingredient_1 !== entry.flour)
    const stored = await sql`SELECT name FROM ingredient_links WHERE recipe_id = ${saved.id} ORDER BY line_id`
    assert.deepEqual(stored.map(row => row.name), ['saffron threads', 'sugar'])
  })

  test('a save during a pass waits for it, then queues the recipe again', async () => {
    const saved = await insertRecipe(db, 'user_a', recipe('en', 'flour'))
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    // A pass holding its claim, as a slow worker would.
    const pass = sql.begin(async (tx) => {
      await tx`DELETE FROM ingredient_queue WHERE recipe_id = ${saved.id}`
      await held
    })
    await new Promise(resolve => setTimeout(resolve, 100))
    const edit = updateRecipe(sql, 'user_a', saved.id, recipe('en', 'sugar'))
    await new Promise(resolve => setTimeout(resolve, 200))
    release()
    await Promise.all([pass, edit])
    assert.deepEqual(await queued(), [saved.id])
    await drainQueue(sql)
    assert.deepEqual(await links(saved.id), { ingredient_1: entry.sugar })
  })

  test('two recipes creating the same new name at once end with one entry', async () => {
    const one = await insertRecipe(db, 'user_in', recipe('en', 'Kala namak'))
    const two = await insertRecipe(db, 'user_in', recipe('en', 'kala namak'))
    await Promise.all([matchNext(sql), matchNext(sql)])
    const [a, b] = [await links(one.id), await links(two.id)]
    assert.ok(a.ingredient_1)
    assert.equal(a.ingredient_1, b.ingredient_1)
    assert.equal(await count(sql`SELECT count(*)::int AS n FROM ingredient_names WHERE lower(name) = 'kala namak'`), 1)
    // The loser's entry was dropped, not left nameless.
    assert.equal(await count(sql`SELECT count(*)::int AS n FROM ingredients WHERE id NOT IN (SELECT ingredient_id FROM ingredient_names)`), 0)
  })

  test('with the database unreachable the recipe stays queued, and a later pass matches it', async () => {
    const saved = await insertRecipe(db, 'user_a', recipe('en', 'sugar'))
    const away = postgres('postgres://nobody:nothing@127.0.0.1:1/none', { max: 1, connect_timeout: 1, onnotice: () => {} })
    await assert.rejects(() => matchNext(away))
    await away.end()
    assert.deepEqual(await queued(), [saved.id])
    assert.deepEqual(await links(saved.id), {})
    await drainQueue(sql)
    assert.deepEqual(await links(saved.id), { ingredient_1: entry.sugar })
  })

  test('a pass that fails rolls back, and holds the recipe back until a retry', async () => {
    const saved = await insertRecipe(db, 'user_a', recipe('en', 'sugar'))
    await sql`ALTER TABLE ingredient_links ADD CONSTRAINT fail_now CHECK (false) NOT VALID`
    try {
      await assert.rejects(() => matchNext(sql), /fail_now/)
    } finally {
      await sql`ALTER TABLE ingredient_links DROP CONSTRAINT fail_now`
    }
    assert.equal((await sql`SELECT not_before > now() AS held FROM ingredient_queue WHERE recipe_id = ${saved.id}`)[0]!.held, true)
    // Held back, so there is nothing to claim; the next save readies it.
    assert.equal(await matchNext(sql), false)
    await updateRecipe(sql, 'user_a', saved.id, recipe('en', 'sugar'))
    await drainQueue(sql)
    assert.deepEqual(await links(saved.id), { ingredient_1: entry.sugar })
  })

  test('workers side by side never take the same recipe', async () => {
    const saved = await Promise.all(Array.from({ length: 12 }, () => insertRecipe(db, 'user_a', recipe('en', 'flour', 'sugar'))))
    const passes = await Promise.all(Array.from({ length: 4 }, async () => {
      let mine = 0
      while (await matchNext(sql)) mine++
      return mine
    }))
    assert.equal(passes.reduce((a, b) => a + b), 12)
    for (const { id } of saved) assert.deepEqual(await links(id), { ingredient_1: entry.flour, ingredient_2: entry.sugar })
  })
  // The owner's answers (#173).
  const nameRows = (name: string) => sql`SELECT ingredient_id, lang, name, is_main, confirmed, source, added_by FROM ingredient_names WHERE lower(name) = lower(${name})`
  const asked = async (owner: string, recipeId: string) => (await readQuestions(sql, owner, recipeId))!.questions
    .map(q => [q.lineId, q.name, q.candidates.map(c => c.ingredientId)])

  test('"same thing, my name" adds a confirmed alias in the recipe’s language, and links the line', async () => {
    const other = await save('user_out', 'en', 'tomatoes')
    const mine = await save('user_in', 'en-GB', 'tomatoes')
    assert.ok((await asked('user_in', mine.id)).some(([, , ids]) => (ids as string[]).includes(entry.tomato!)))
    assert.equal(await answerQuestion(sql, 'user_in', mine.id, 'ingredient_1', 'alias', entry.tomato!), true)
    assert.deepEqual([...await nameRows('tomatoes')].map(row => ({ ...row })), [{ ingredient_id: entry.tomato, lang: 'en', name: 'tomatoes', is_main: false, confirmed: true, source: 'cook', added_by: 'user_in' }])
    assert.deepEqual(await links(mine.id), { ingredient_1: entry.tomato })
    assert.deepEqual(await candidates(mine.id), [])
    assert.deepEqual(await asked('user_in', mine.id), [])
    // In the shared store at once: the next cook's line is an exact match.
    // The cook who saved before is untouched until their own next pass.
    assert.deepEqual(await links(other.id), {})
    assert.deepEqual((await findRecipe(sql, 'user_out', other.id))!.ingredients, other.ingredients)
    assert.deepEqual(await links((await save('user_out', 'en', 'Tomatoes')).id), { ingredient_1: entry.tomato })
  })

  test('"typo" takes the matched name and links it; originalText stays and the misspelling is not stored', async () => {
    const mine = await save('user_in', 'en', 'tomatto')
    assert.equal(await answerQuestion(sql, 'user_in', mine.id, 'ingredient_1', 'typo', entry.tomato!), true)
    const line = (await findRecipe(sql, 'user_in', mine.id))!.ingredients[0]!
    assert.equal(line.name, 'tomato')
    assert.equal(line.originalText, 'tomatto')
    assert.equal((await nameRows('tomatto')).length, 0)
    assert.deepEqual(await links(mine.id), { ingredient_1: entry.tomato })
    // The rename queued the recipe; its pass keeps the link.
    await drainQueue(sql)
    assert.deepEqual(await links(mine.id), { ingredient_1: entry.tomato })
  })

  test('"none of these" makes a new entry under the line’s name, and links it', async () => {
    const mine = await save('user_in', 'en', 'tomatillos verdes')
    assert.ok((await candidates(mine.id)).length)
    assert.equal(await answerQuestion(sql, 'user_in', mine.id, 'ingredient_1', 'none', null), true)
    const [made] = await nameRows('tomatillos verdes')
    assert.deepEqual({ ...made, ingredient_id: undefined }, { ingredient_id: undefined, lang: 'en', name: 'tomatillos verdes', is_main: true, confirmed: true, source: 'cook', added_by: 'user_in' })
    assert.deepEqual(await links(mine.id), { ingredient_1: made!.ingredient_id })
  })

  test('picking an unconfirmed name confirms it', async () => {
    const mine = await save('user_in', 'en', 'bay leaf')
    assert.equal(await answerQuestion(sql, 'user_in', mine.id, 'ingredient_1', 'typo', entry.laurel!), true)
    assert.equal((await findRecipe(sql, 'user_in', mine.id))!.ingredients[0]!.name, 'bay leaves')
    assert.deepEqual([...await nameRows('bay leaves')].map(row => [row.ingredient_id, row.confirmed, row.is_main]), [[entry.laurel, true, false]])
    // Now an exact match for anyone.
    assert.deepEqual(await links((await save('user_out', 'en', 'bay leaves')).id), { ingredient_1: entry.laurel })
  })

  test('no question to answer: another cook’s recipe, opted out, a changed line, or a candidate not offered', async () => {
    const mine = await save('user_in', 'en', 'tomattos')
    assert.equal(await readQuestions(sql, 'user_out', mine.id), null)
    assert.equal(await answerQuestion(sql, 'user_out', mine.id, 'ingredient_1', 'typo', entry.tomato!), null)
    assert.equal(await answerQuestion(sql, 'user_in', mine.id, 'ingredient_1', 'typo', entry.sugar!), null)
    assert.equal(await answerQuestion(sql, 'user_in', mine.id, 'ingredient_9', 'none', null), null)
    // Renamed under the same id: the question was about the old name.
    await updateRecipe(sql, 'user_in', mine.id, recipe('en', 'sugar'))
    assert.equal(await answerQuestion(sql, 'user_in', mine.id, 'ingredient_1', 'typo', entry.tomato!), null)
    // Opted out since: nothing is asked, and nothing can be answered.
    const again = await save('user_in', 'en', 'tomattos')
    await sql`UPDATE preferences SET settings = '{}' WHERE owner_sub = 'user_in'`
    try {
      assert.deepEqual(await asked('user_in', again.id), [])
      assert.equal(await answerQuestion(sql, 'user_in', again.id, 'ingredient_1', 'typo', entry.tomato!), null)
    } finally {
      await sql`UPDATE preferences SET settings = ${sql.json({ ingredientMatching: 'on' })} WHERE owner_sub = 'user_in'`
    }
    // A recipe of unknown language files nothing under one; a typo is fine.
    const unknown = await save('user_in', 'und', 'tomattos')
    assert.equal(await answerQuestion(sql, 'user_in', unknown.id, 'ingredient_1', 'alias', entry.tomato!), 'und')
    assert.equal(await answerQuestion(sql, 'user_in', unknown.id, 'ingredient_1', 'typo', entry.tomato!), true)
  })
  test('a pass and an answer each tell listeners the recipe’s id', async () => {
    const heard: string[] = []
    const { unlisten } = await sql.listen(MATCHED, payload => heard.push(payload))
    try {
      const mine = await save('user_in', 'en', 'tomatoe')
      await answerQuestion(sql, 'user_in', mine.id, 'ingredient_1', 'typo', entry.tomato!)
      for (let i = 0; i < 50 && heard.filter(heardId => heardId === mine.id).length < 2; i++) await new Promise(resolve => setTimeout(resolve, 20))
      // The channel is the database's; listeners pick out their recipe.
      assert.deepEqual(heard.filter(heardId => heardId === mine.id), [mine.id, mine.id])
    } finally {
      await unlisten()
    }
  })

  // Opting in (#180). The queue in order, and when each comes due.
  const queue = async () => [...await sql<{ recipe_id: string, due: number }[]>`
    SELECT recipe_id, round(extract(epoch FROM not_before - now()) / 3600)::int AS due
    FROM ingredient_queue ORDER BY queued_at`]
  const setMatching = (owner: string, on: boolean, backfill: 'batched' | null = null) =>
    writePreferences(db, owner, { ...NO_PREFERENCES, ingredientMatching: on ? 'on' : null, ingredientBackfill: backfill })

  test('opting in queues every recipe the cook has, newest first; no change, or opting out, queues nothing', async () => {
    const asked = await save('user_late', 'en', 'tomatos')
    const exact = await save('user_late', 'en', 'flour')
    const newest = await save('user_late', 'en', 'tomatos', 'Szechuan pepper')
    // What a pass would ask: the two close lines, not the exact one or the miss. It writes nothing.
    assert.equal(await previewQuestions(sql, 'user_late'), 2)
    assert.equal(await count(sql`SELECT count(*)::int AS n FROM ingredient_candidates WHERE owner_sub = 'user_late'`), 0)
    assert.equal(await count(sql`SELECT count(*)::int AS n FROM ingredient_queue`), 0)

    await setMatching('user_late', true)
    assert.deepEqual(await queue(), [newest, exact, asked].map(r => ({ recipe_id: r.id, due: 0 })))
    await drainQueue(sql)
    assert.equal(await countWaiting(sql, 'user_late'), 2)

    await setMatching('user_late', true)
    assert.deepEqual(await queue(), [])
    await setMatching('user_late', false)
    assert.deepEqual(await queue(), [])
    // Questions stored from that opt-in stay, and count again next time.
    assert.equal(await previewQuestions(sql, 'user_late'), 2)
  })

  test('a batch at a time: each batch one spacing later; a queued recipe keeps its place; opting out halfway asks nothing', async () => {
    const [first, second, third] = [await save('user_slow', 'en', 'tomatos'), await save('user_slow', 'en', 'tomatos'), await save('user_slow', 'en', 'tomatos')]
    // Saved and not yet matched: already queued.
    const waiting = await insertRecipe(db, 'user_slow', recipe('en', 'tomatos'))
    const [{ queued_at: before }] = await sql`SELECT queued_at FROM ingredient_queue WHERE recipe_id = ${waiting.id}`
    await sql.begin(async (tx) => {
      await tx`SELECT set_config('recipeat.ingredient_backfill_batch', '2', true), set_config('recipeat.ingredient_backfill_hours', '3', true)`
      await tx`INSERT INTO preferences (owner_sub, settings) VALUES ('user_slow', ${tx.json({ ingredientMatching: 'on', ingredientBackfill: 'batched' })})`
    })
    assert.deepEqual(await queue(), [
      { recipe_id: waiting.id, due: 0 },
      { recipe_id: third.id, due: 0 },
      { recipe_id: second.id, due: 3 },
      { recipe_id: first.id, due: 3 },
    ])
    assert.deepEqual((await sql`SELECT queued_at FROM ingredient_queue WHERE recipe_id = ${waiting.id}`)[0]!.queued_at, before)

    await setMatching('user_slow', false)
    await sql`UPDATE ingredient_queue SET not_before = now()`
    await drainQueue(sql)
    assert.equal(await count(sql`SELECT count(*)::int AS n FROM ingredient_candidates WHERE owner_sub = 'user_slow'`), 0)
  })

  test('a cook with no recipes opts in to nothing, without error', async () => {
    assert.equal(await previewQuestions(sql, 'user_none'), 0)
    await setMatching('user_none', true, 'batched')
    assert.deepEqual(await queue(), [])
    assert.equal(await countWaiting(sql, 'user_none'), 0)
  })

  // The store in recipes (#181): entries joined on read, liquids asked, filters by entry.
  const measured = async (owner: string, lang: string, ...lines: [amount: string, name: string][]) => {
    const saved = await insertRecipe(db, owner, normalizeRecipe(parseExtraction({
      title: 'Measured',
      source_lang: lang,
      ingredients: lines.map(([amount, name]) => ({ originalText: `${amount} ${name}`, quantity: amount, name })),
      steps: ['Cook.'],
    }, { type: 'text', originalText: 'x' })))
    await drainQueue(sql)
    return saved
  }
  const entries = async (owner: string, id: string) => (await findRecipe(sql, owner, id))!.ingredients.map(line => line.ingredient)

  test('a recipe reads with each line’s entry, named in its language; a line renamed since, or unlinked, has none', async () => {
    await sql`UPDATE ingredients SET density_g_per_ml = 0.53, density_source = 'fdc' WHERE id = ${entry.flour!}`
    const german = await measured('user_a', 'de-DE', ['500 g', 'Mehl'], ['1', 'Ei'])
    assert.deepEqual(await entries('user_a', german.id), [{ id: entry.flour, name: 'Mehl', densityGPerMl: 0.53, isLiquid: null }, null])
    const english = await measured('user_a', 'en', ['1 cup', 'farina'])
    assert.deepEqual((await entries('user_a', english.id))[0]!.name, 'flour')

    // Renamed and saved: the link is stale, and the save's own answer says so.
    const body = structuredClone(await findRecipe(sql, 'user_a', german.id)) as unknown as Record<string, unknown>
    ;(body.ingredients as { name: string }[])[0]!.name = 'Dinkelmehl'
    const { draft, source } = validateRecipe(body)
    const saved = (await updateRecipe(sql, 'user_a', german.id, normalizeRecipe(parseExtraction(draft, source))))!
    assert.equal(saved.ingredients[0]!.ingredient, null)
    assert.equal((await entries('user_a', german.id))[0], null)
  })

  test('saving a recipe that carries its entries writes none of them', async () => {
    const mine = await measured('user_a', 'en', ['2 cups', 'flour'])
    const read = (await findRecipe(sql, 'user_a', mine.id))!
    assert.ok(read.ingredients[0]!.ingredient)
    const { draft, source } = validateRecipe({ recipe: read })
    const saved = (await updateRecipe(sql, 'user_a', mine.id, normalizeRecipe(parseExtraction(draft, source))))!
    assert.equal(saved.ingredients[0]!.ingredient!.id, entry.flour)
    const [{ stored }] = await sql<{ stored: number }[]>`
      SELECT count(*)::int AS stored FROM recipes, jsonb_array_elements(ingredients) AS line
      WHERE line ? 'ingredient'`
    assert.equal(stored, 0)
  })

  test('opted-in owners are asked whether a measured-by-volume entry is a liquid; the first answer is everyone’s', async () => {
    await sql`UPDATE ingredients SET density_g_per_ml = 0.85, density_source = 'fdc' WHERE id = ${entry.sugar!}`
    const mine = await measured('user_in', 'en', ['1 cup', 'sugar'], ['100 g', 'flour'], ['1', 'tomato'], ['2 tbsp', 'sugar'])
    const also = await measured('user_in', 'de', ['1 cup', 'Zucker'])
    const theirs = await measured('user_out', 'en', ['1 cup', 'sugar'])
    const abouts = async (owner: string, id: string) => (await readQuestions(sql, owner, id))!.questions.filter(q => q.kind === 'about')
    // Only the cup: grams need no conversion, the tomato has no density, and
    // a spoon is a spoon either way.
    assert.deepEqual(await abouts('user_in', mine.id), [{ kind: 'about', lineId: 'ingredient_1', name: 'sugar', ingredientId: entry.sugar }])
    assert.equal((await abouts('user_in', also.id)).length, 1)
    assert.equal(await countWaiting(sql, 'user_in') >= 2, true)
    // Opted out: never asked, and the answer still reaches them.
    assert.deepEqual(await abouts('user_out', theirs.id), [])
    assert.equal(await answerQuestion(sql, 'user_out', theirs.id, 'ingredient_1', 'solid', null), null)

    const told: string[] = []
    const { unlisten } = await sql.listen(MATCHED, id => told.push(id))
    assert.equal(await answerQuestion(sql, 'user_in', mine.id, 'ingredient_1', 'solid', null), true)
    await new Promise(resolve => setTimeout(resolve, 200))
    await unlisten()
    assert.ok([mine.id, also.id, theirs.id].every(id => told.includes(id)))
    assert.deepEqual(await abouts('user_in', mine.id), [])
    assert.deepEqual(await abouts('user_in', also.id), [])
    assert.equal((await entries('user_out', theirs.id))[0]!.isLiquid, false)

    // A second answer, to the question left open in another tab, changes nothing.
    assert.equal(await answerQuestion(sql, 'user_in', also.id, 'ingredient_1', 'liquid', null), null)
    assert.equal((await sql`SELECT is_liquid FROM ingredients WHERE id = ${entry.sugar!}`)[0]!.is_liquid, false)
  })

  test('an ingredient filter finds lines by their entry’s names in any language, and by text otherwise', async () => {
    const german = await measured('user_f', 'de', ['500 g', 'Mehl'])
    const typed = await measured('user_f', 'en', ['1', 'quinoa'])
    const found = async (term: string) => (await listRecipes(sql, 'user_f', { ...NO_FILTERS, ingredients: [term] })).map(row => row.id)
    assert.deepEqual(await found('flour'), [german.id])
    assert.deepEqual(await found('FARINA'), [german.id])
    assert.deepEqual(await found('quin'), [typed.id])
    assert.deepEqual(await found('Mehl'), [german.id])
    assert.deepEqual(await found('sugar'), [])
  })

  // One answer settles the same question elsewhere (#194).
  test('"same thing" re-matches every opted-in cook’s recipes asking about that name; other languages keep asking', async () => {
    await setMatching('user_in2', true)
    await setMatching('user_gone', true)
    const mine = await save('user_in', 'en', 'farinna')
    const theirs = await save('user_in2', 'en', 'Farinna')
    const german = await save('user_in2', 'de', 'farinna')
    const gone = await save('user_gone', 'en', 'farinna')
    await setMatching('user_gone', false)
    // Waiting in a batched backfill, a day out.
    const held = await insertRecipe(db, 'user_in2', recipe('en', 'farinna'))
    await sql`UPDATE ingredient_queue SET not_before = now() + interval '1 day' WHERE recipe_id = ${held.id}`
    const [before] = await sql`SELECT queued_at, not_before FROM ingredient_queue WHERE recipe_id = ${held.id}`
    for (const { id } of [mine, theirs, german, gone]) assert.ok((await candidates(id)).length)

    assert.equal(await answerQuestion(sql, 'user_in', mine.id, 'ingredient_1', 'alias', entry.flour!), true)
    assert.deepEqual(new Set((await queue()).map(row => row.recipe_id)), new Set([held.id, theirs.id, german.id]))
    assert.deepEqual((await sql`SELECT queued_at, not_before FROM ingredient_queue WHERE recipe_id = ${held.id}`)[0], before)

    const told: string[] = []
    const { unlisten } = await sql.listen(MATCHED, id => told.push(id))
    await drainQueue(sql)
    await new Promise(resolve => setTimeout(resolve, 200))
    await unlisten()
    assert.deepEqual(await links(theirs.id), { ingredient_1: entry.flour })
    assert.deepEqual(await asked('user_in2', theirs.id), [])
    assert.ok(told.includes(theirs.id))
    // Filed under en: the German recipe's line is no exact match, and still asks.
    assert.deepEqual(await links(german.id), {})
    assert.equal((await asked('user_in2', german.id)).length, 1)
    // Opted out: left as it was, and the held recipe still waits its turn.
    assert.ok((await candidates(gone.id)).length)
    assert.deepEqual((await queue()).map(row => row.recipe_id), [held.id])
    await sql`DELETE FROM ingredient_queue`
  })

  test('"none of these" settles the same name elsewhere; "typo" queues nothing', async () => {
    const mine = await save('user_in', 'en', 'tomatillos rojos')
    const theirs = await save('user_in2', 'en', 'tomatillos rojos')
    assert.ok((await candidates(theirs.id)).length)
    assert.equal(await answerQuestion(sql, 'user_in', mine.id, 'ingredient_1', 'none', null), true)
    assert.deepEqual((await queue()).map(row => row.recipe_id), [theirs.id])
    await drainQueue(sql)
    assert.deepEqual(await links(theirs.id), await links(mine.id))
    assert.deepEqual(await asked('user_in2', theirs.id), [])

    const typo = await save('user_in', 'en', 'tomatto')
    const other = await save('user_in2', 'en', 'tomatto')
    assert.equal(await answerQuestion(sql, 'user_in', typo.id, 'ingredient_1', 'typo', entry.tomato!), true)
    // The rename queued the answered recipe itself, and nothing else.
    assert.deepEqual((await queue()).map(row => row.recipe_id), [typo.id])
    await drainQueue(sql)
    assert.equal((await asked('user_in2', other.id)).length, 1)
  })
})

describe('ingredient lookups', { skip: url ? false : 'NUXT_DATABASE_URL is not set' }, () => {
  const SCHEMA = 'lookup_check'
  let admin: Sql
  let sql: Sql
  const config = { searxngBaseUrl: 'http://searx.test', ingredientLookupBaseMinutes: 5 }

  before(async () => {
    admin = postgres(url!, { max: 1, onnotice: () => {} })
    await admin`DROP SCHEMA IF EXISTS ${admin(SCHEMA)} CASCADE`
    await admin`CREATE SCHEMA ${admin(SCHEMA)}`
    sql = postgres(url!, { max: 4, onnotice: () => {}, connection: { search_path: SCHEMA } })
    await applyMigrations(sql, migrations(...STORE))
  })

  after(async () => {
    await sql?.end()
    await admin`DROP SCHEMA IF EXISTS ${admin(SCHEMA)} CASCADE`
    await admin?.end()
  })

  // An entry a cook made `minutes` ago under `name`, as matching makes one;
  // `by` null is a seeded one.
  async function made(name: string, minutes: number, by: string | null = 'user_a') {
    const [{ id }] = await sql<{ id: string }[]>`
      INSERT INTO ingredients (created_by, created_at) VALUES (${by}, now() - ${minutes} * interval '1 minute') RETURNING id`
    await sql`INSERT INTO ingredient_names (ingredient_id, lang, name, is_main, confirmed, source, added_by)
      VALUES (${id}, 'en', ${name}, true, true, ${by ? 'cook' : 'off'}, ${by})`
    return id
  }
  const ago = async (minutes: number) => (await sql<{ t: Date }[]>`SELECT now() - ${minutes} * interval '1 minute' AS t`)[0]!.t
  // Wikidata and SearXNG answering as given; null is down. Counts the calls.
  function sources(names: Record<string, string> | null, snippet: string | null) {
    const calls = { wikidata: 0, searxng: 0 }
    const fetcher = (async (input: URL) => {
      if (input.host === 'www.wikidata.org') {
        calls.wikidata++
        if (!names) return new Response('', { status: 503 })
        return new Response(JSON.stringify(input.searchParams.get('action') === 'wbsearchentities'
          ? { search: [{ id: 'Q1' }] }
          : { entities: { Q1: { labels: Object.fromEntries(Object.entries(names).map(([language, value]) => [language, { language, value }])) } } }))
      }
      calls.searxng++
      if (snippet === null) throw new Error('connection refused')
      return new Response(JSON.stringify({ results: [
        { url: 'https://a.com/', title: 'Something', content: 'No figure.' },
        { url: 'https://b.com/density', title: 'Density', content: snippet },
      ] }))
    }) as typeof fetch
    return { calls, fetcher }
  }
  const namesOf = (id: string) => sql`SELECT lang, name, is_main, confirmed, source FROM ingredient_names WHERE ingredient_id = ${id} ORDER BY lang`
  const densityOf = async (id: string) => ({ ...(await sql`SELECT density_g_per_ml::float AS value, density_source, density_ref FROM ingredients WHERE id = ${id}`)[0] })
  const none = { value: null, density_source: null, density_ref: null }

  test('a new entry gets unconfirmed names in other languages and a density with its address', async () => {
    const since = await ago(1)
    const id = await made('nutmeg', 0)
    await lookUpDue(sql, since, config, sources({ en: 'nutmeg', de: 'Muskatnuss', fr: 'noix de muscade' }, 'Ground nutmeg: 0.47 g/ml.').fetcher)
    assert.deepEqual([...await namesOf(id)].map(row => ({ ...row })), [
      { lang: 'de', name: 'Muskatnuss', is_main: false, confirmed: false, source: 'wikidata' },
      { lang: 'en', name: 'nutmeg', is_main: true, confirmed: true, source: 'cook' },
      { lang: 'fr', name: 'noix de muscade', is_main: false, confirmed: false, source: 'wikidata' },
    ])
    assert.deepEqual(await densityOf(id), { value: 0.47, density_source: 'searxng', density_ref: 'https://b.com/density' })
    // Found both: not looked up again, whatever is due.
    const again = sources({ de: 'x' }, '1 g/ml')
    await lookUpDue(sql, await ago(60 * 24 * 8), config, again.fetcher)
    assert.deepEqual(again.calls, { wikidata: 0, searxng: 0 })
  })

  test('an unconfirmed name makes a candidate, never a link', async () => {
    const since = await ago(1)
    await made('mace', 0)
    await lookUpDue(sql, since, config, sources({ de: 'Macis' }, null).fetcher)
    await sql`INSERT INTO preferences (owner_sub, settings) VALUES ('user_in', ${sql.json({ ingredientMatching: 'on' })})`
    const db = new Kysely<Database>({ dialect: new PostgresJSDialect({ postgres: sql }) })
    const saved = await insertRecipe(db, 'user_in', normalizeRecipe(parseExtraction(
      { title: 'Test', source_lang: 'de', ingredients: [{ originalText: 'Macis', quantity: null, name: 'Macis' }], steps: ['Kochen.'] },
      { type: 'text', originalText: 'Macis' })))
    await drainQueue(sql)
    assert.equal((await sql`SELECT 1 FROM ingredient_links WHERE recipe_id = ${saved.id}`).length, 0)
    assert.deepEqual((await sql`SELECT matched_name FROM ingredient_candidates WHERE recipe_id = ${saved.id}`).map(row => row.matched_name), ['Macis'])
  })

  test('no figure, or a source down: that part stays missing, and the other is kept', async () => {
    // Each case alone, so an earlier entry still due doesn't take its names.
    await sql`DELETE FROM ingredients`
    const noFigure = await made('sumac', 0)
    await lookUpDue(sql, await ago(1), config, sources({ de: 'Sumach' }, 'Sumac is a spice.').fetcher)
    assert.deepEqual(await densityOf(noFigure), none)
    assert.equal((await namesOf(noFigure)).length, 2)

    await sql`DELETE FROM ingredients`
    const down = await made('zaatar', 0)
    await lookUpDue(sql, await ago(1), config, sources(null, null).fetcher)
    assert.equal((await namesOf(down)).length, 1)
    assert.deepEqual(await densityOf(down), none)

    // SearXNG unconfigured: names still come, the density waits.
    await sql`DELETE FROM ingredients`
    const unconfigured = await made('ajwain', 0)
    await lookUpDue(sql, await ago(1), { ...config, searxngBaseUrl: '' }, sources({ de: 'Königskümmel' }, '1 g/ml').fetcher)
    assert.equal((await namesOf(unconfigured)).length, 2)
    assert.deepEqual(await densityOf(unconfigured), none)
  })

  test('tries fall at base·k² after creation, for a week, for entries cooks made', async () => {
    await sql`DELETE FROM ingredients`
    // Since two minutes ago, base 5: the try at 20 min (k=2) is due for an
    // entry 21 minutes old; none falls in the last two for one 19 minutes old.
    await made('caraway', 21)
    await made('fenugreek', 19)
    // k=44 falls at 9680 min, inside the week; 7 days and 5 minutes is past it.
    await made('mahlab', 9681)
    await made('nigella', 60 * 24 * 7 + 5)
    // Seeded: never looked up.
    await made('cumin', 21, null)
    const { calls, fetcher } = sources({}, null)
    const next = await lookUpDue(sql, await ago(2), config, fetcher)
    // Each due entry: Wikidata's search and its (empty) labels, one web search.
    assert.deepEqual(calls, { wikidata: 4, searxng: 2 })
    // The answer is the next call's since: nothing is due again at once.
    await lookUpDue(sql, next, config, fetcher)
    assert.deepEqual(calls, { wikidata: 4, searxng: 2 })
  })

  test('an entry another lookup holds is skipped, not waited for', async () => {
    await sql`DELETE FROM ingredients`
    const held = await made('anise', 0)
    await made('cardamom', 0)
    const { calls, fetcher } = sources({}, null)
    const since = await ago(1)
    await sql.begin(async (tx) => {
      await tx`SELECT 1 FROM ingredients WHERE id = ${held} FOR NO KEY UPDATE`
      await lookUpDue(sql, since, config, fetcher)
    })
    assert.deepEqual(calls, { wikidata: 2, searxng: 1 })
  })
})
