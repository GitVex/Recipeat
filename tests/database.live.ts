import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import postgres, { type Sql } from 'postgres'
import { applyMigrations } from '../server/database/migrate.ts'

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
