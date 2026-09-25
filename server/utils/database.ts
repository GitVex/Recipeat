import postgres, { type Sql } from 'postgres'

// One pool for the process. Nitro has no lifecycle hook that hands a handler a
// connection, so this is the shared thing every query reaches for, created on
// first use rather than at import so that a build — which imports this file —
// never opens a socket.
let pool: Sql | undefined

export function useDatabase(): Sql {
  if (!pool) {
    const { databaseUrl } = useRuntimeConfig()
    if (!databaseUrl) throw new Error('NUXT_DATABASE_URL is not set')
    pool = postgres(databaseUrl, {
      // The app is one container answering one host's traffic; ten is already
      // more than the extraction routes can be waiting on at once.
      max: 10,
      // NOTICE is Postgres talking to a psql user, not to a server log.
      onnotice: () => {},
    })
  }
  return pool
}

// The database is a separate Coolify resource, so the app cannot depend_on it
// and will sometimes start first — and a database restart should not need the
// app restarted after it. Waits for the first connection, and gives up rather
// than holding requests open forever.
export async function waitForDatabase(sql: Sql, attempts = 12, delayMs = 2_000): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await sql`SELECT 1`
      return
    } catch (error) {
      if (attempt >= attempts) throw error
      // Flat rather than backed off: this is a container starting, which takes
      // seconds, not a service under load that wants to be left alone.
      console.warn(`[database] not ready (attempt ${attempt}/${attempts}), retrying in ${delayMs}ms`)
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }
  }
}

export async function closeDatabase(): Promise<void> {
  const open = pool
  pool = undefined
  await open?.end({ timeout: 5 })
}

export { applyMigrations, migrationOrder, type Migration } from '../database/migrate.ts'
