import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import postgres, { type Sql } from 'postgres'
import { Kysely } from 'kysely'
import { PostgresJSDialect } from 'kysely-postgres-js'
import { applyMigrations } from '../server/database/migrate.ts'
import type { Database } from '../server/database/schema.ts'
import { normalizeRecipe, parseExtraction } from '../server/utils/extraction.ts'
import { findRecipe, insertProgression, insertRecipe, insertVariant, listRecipes, updateRecipe } from '../server/recipes/store.ts'

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
    const version = '001_recipes.sql'
    const body = readFileSync(new URL(`../server/database/migrations/${version}`, import.meta.url), 'utf8')
    await applyMigrations(sql, [{ version, sql: body }])
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
    const version = '001_recipes.sql'
    const body = readFileSync(new URL(`../server/database/migrations/${version}`, import.meta.url), 'utf8')
    await applyMigrations(sql, [{ version, sql: body }])
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
})
