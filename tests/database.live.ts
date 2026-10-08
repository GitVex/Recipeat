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
import { readFilters } from '../shared/utils/recipeFilters.ts'

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
const STORE = ['001_recipes.sql', '002_collections.sql', '003_tags.sql', '004_preferences.sql', '005_images.sql']

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
    // JSONB round-trips whole: the parts and the links normalizeRecipe found.
    assert.deepEqual(found!.ingredients, recipe('Bread').ingredients)
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
    assert.deepEqual(await readPreferences(db, 'nobody'), { unitSystem: null, portions: null, paperNudge: null, theme: null, grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null })
  })

  test('a save replaces the whole set, per owner', async () => {
    assert.deepEqual(await writePreferences(db, 'user_a', { unitSystem: 'imperial', portions: 4, paperNudge: null, theme: null, grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null }), { unitSystem: 'imperial', portions: 4, paperNudge: null, theme: null, grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null })
    await writePreferences(db, 'user_b', { unitSystem: 'metric', portions: null, paperNudge: null, theme: null, grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null })
    assert.deepEqual(await writePreferences(db, 'user_a', { unitSystem: null, portions: 2, paperNudge: null, theme: null, grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null }), { unitSystem: null, portions: 2, paperNudge: null, theme: null, grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null })
    assert.deepEqual(await readPreferences(db, 'user_a'), { unitSystem: null, portions: 2, paperNudge: null, theme: null, grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null })
    assert.deepEqual(await readPreferences(db, 'user_b'), { unitSystem: 'metric', portions: null, paperNudge: null, theme: null, grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null })
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
    assert.deepEqual(await readPreferences(db, 'user_d'), { unitSystem: null, portions: 4, paperNudge: null, theme: null, grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null })
    await writePreferences(db, 'user_d', { unitSystem: 'metric', portions: 4, paperNudge: null, theme: null, grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null })
    const [{ settings }] = await sql<{ settings: unknown }[]>`SELECT settings FROM preferences WHERE owner_sub = 'user_d'`
    assert.deepEqual(settings, { unitSystem: 'metric', portions: 4, paperNudge: null, theme: null, grainEffect: null, stampEffect: null, misprintEffect: null, halftoneEffect: null, ticketEffect: null })
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
    assert.deepEqual(await listPhotos(db, 'user_a', again!.id), { photos: [], source: null })
    assert.deepEqual(ids(await listPhotos(db, 'user_a', stew.id)), [first])
    const card = async () => (await listRecipes(sql, 'user_a')).find(entry => entry.lineId === stew.id)!.image
    // The pin has none yet, so the line's is shown rather than nothing.
    assert.equal(await card(), `/api/images/${first}?size=thumb`)
    const [own] = ids(await addPhoto(db, 'user_a', again!.id, upload(2)))
    assert.equal(await card(), `/api/images/${own}?size=thumb`)
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
