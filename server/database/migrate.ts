import type { Sql } from 'postgres'

// pg_advisory_lock takes a 64-bit key that every deployment has to agree on and
// that means nothing else. 8100 is the app's port, and the suffix leaves room
// for a second lock if anything else ever needs one.
const LOCK_KEY = 8100_01

// Filenames are the apply order, so they have to sort correctly as strings:
// three digits at least, zero-padded, then a name. Anything that does not look
// like a migration is refused rather than guessed at — a typo that silently
// skips a file is the one failure mode this whole mechanism exists to prevent.
const FILENAME = /^(\d{3,})_[a-z0-9_]+\.sql$/

export type Migration = { version: string, sql: string }

// Split out from the run so it can be tested without a database: it is the
// half that decides what gets applied and in which order.
export function migrationOrder(names: string[]): string[] {
  // Case-insensitively, so a stray .SQL is refused below rather than quietly
  // skipped — on a case-insensitive filesystem it is a migration that never runs.
  const files = names.filter(name => /\.sql$/i.test(name))
  const invalid = files.filter(name => !FILENAME.test(name))
  if (invalid.length > 0) {
    throw new Error(`Migration filenames must be NNN_name.sql: ${invalid.sort().join(', ')}`)
  }
  const ordered = files.sort()
  // Two files sharing a number apply in alphabetical order, which is an
  // accident rather than a decision — and usually means two branches each
  // added "the next" migration.
  const seen = new Map<string, string>()
  for (const name of ordered) {
    const number = name.match(FILENAME)![1]
    const first = seen.get(number)
    if (first) throw new Error(`Two migrations numbered ${number}: ${first} and ${name}`)
    seen.set(number, name)
  }
  return ordered
}

// Applies every migration not already in schema_migrations, in order, and
// answers with the versions it applied. Re-running with nothing new to do is a
// handful of queries and no writes.
export async function applyMigrations(sql: Sql, migrations: Migration[]): Promise<string[]> {
  const applied: string[] = []
  // An advisory lock is held by a session, so it has to be taken and released
  // on one connection rather than whatever the pool hands out next. Two app
  // containers starting together is the case this covers: the second waits
  // here and then finds nothing left to do.
  const db = await sql.reserve()
  try {
    await db`SELECT pg_advisory_lock(${LOCK_KEY})`
    try {
      await db`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version TEXT PRIMARY KEY,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `
      const rows = await db<{ version: string }[]>`SELECT version FROM schema_migrations`
      const done = new Set(rows.map(row => row.version))
      for (const migration of migrations) {
        if (done.has(migration.version)) continue
        // BEGIN and COMMIT by hand rather than sql.begin(): a reserved
        // connection has no begin() at runtime, whatever the types say, and
        // the transaction has to be on this session anyway — it is the one
        // holding the lock.
        await db`BEGIN`
        try {
          // Simple protocol: a migration is a file of several statements, and
          // the extended protocol a tagged template uses carries one. The file
          // must not open a transaction of its own — this is it.
          await db.unsafe(migration.sql).simple()
          await db`INSERT INTO schema_migrations (version) VALUES (${migration.version})`
          await db`COMMIT`
        } catch (error) {
          await db`ROLLBACK`
          throw error
        }
        applied.push(migration.version)
      }
    } finally {
      await db`SELECT pg_advisory_unlock(${LOCK_KEY})`
    }
  } finally {
    db.release()
  }
  return applied
}
