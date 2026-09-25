import assert from 'node:assert/strict'
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
