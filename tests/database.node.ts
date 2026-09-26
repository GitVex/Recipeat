import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Sql } from 'postgres'
import { migrationOrder } from '../server/database/migrate.ts'
import { waitForDatabase } from '../server/utils/database.ts'

// A query is `sql\`SELECT 1\``, so a stand-in is a function: it fails the first
// `down` calls and answers after that, the way a container that is still
// starting does.
const database = (down: number) => {
  let calls = 0
  return ((() => (++calls <= down ? Promise.reject(new Error('ECONNREFUSED')) : Promise.resolve([{ ok: 1 }]))) as unknown) as Sql
}

// applyMigrations wants a database and is exercised by running the app; this
// covers the half that decides what gets applied and in which order, which is
// the half where a mistake is silent.

test('migration order is filename order, and ignores what is not a migration', () => {
  const names = ['003_tags.sql', 'README.md', '001_recipes.sql', '010_translations.sql', '002_lineage.sql']
  assert.deepEqual(migrationOrder(names), ['001_recipes.sql', '002_lineage.sql', '003_tags.sql', '010_translations.sql'])
  assert.deepEqual(migrationOrder([]), [])
  assert.deepEqual(migrationOrder(['README.md']), [])
})

test('zero padding is what keeps string order and apply order the same', () => {
  // The reason the runner insists on it: sorted as strings, 10 precedes 2.
  assert.deepEqual(migrationOrder(['010_b.sql', '002_a.sql']), ['002_a.sql', '010_b.sql'])
  assert.throws(() => migrationOrder(['2_a.sql', '10_b.sql']), /must be NNN_name\.sql/)
})

test('a filename that is not a migration name is refused rather than skipped', () => {
  for (const name of ['recipes.sql', '01_recipes.sql', '001-recipes.sql', '001_Recipes.sql', '001_recipes.SQL']) {
    assert.throws(() => migrationOrder([name]), /must be NNN_name\.sql/, name)
  }
})

test('a database that is still starting is waited for, not failed on', async () => {
  await waitForDatabase(database(3), 5, 0)
})

test('a database that never answers gives up with the last error', async () => {
  await assert.rejects(() => waitForDatabase(database(Infinity), 3, 0), /ECONNREFUSED/)
})

test('two migrations sharing a number are refused', () => {
  assert.throws(
    () => migrationOrder(['001_recipes.sql', '001_lineage.sql']),
    /Two migrations numbered 001: 001_lineage\.sql and 001_recipes\.sql/,
  )
})
