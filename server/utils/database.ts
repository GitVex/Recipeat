import { createError } from 'h3'
import { Kysely } from 'kysely'
import { PostgresJSDialect } from 'kysely-postgres-js'
import postgres, { type Sql } from 'postgres'
import type { Database } from '../database/schema.ts'

// One pool for the process. Nitro has no lifecycle hook that hands a handler a
// connection, so this is the shared thing every query reaches for, created on
// first use rather than at import so that a build — which imports this file —
// never opens a socket.
let pool: Sql | undefined

// A deployment always has one: compose.app.yaml marks NUXT_DATABASE_URL
// required. A checkout and the auth fixture may not, and neither needs a
// database to serve the landing page or sign a user in — so the absence is a
// configuration this app can run in, and the storage routes are what refuse.
export const hasDatabase = (): boolean => Boolean(useRuntimeConfig().databaseUrl)

/**
 * The pool, for a caller that is answering a request. Storage is not optional
 * for these, so a deployment without a database says so plainly rather than
 * failing somewhere inside a query.
 */
export function requireDatabase(): Sql {
  if (!hasDatabase()) throw createError({ statusCode: 503, message: 'Storage is not configured on this deployment.' })
  return useDatabase()
}

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

// Kysely over the same postgres.js instance rather than a pool of its own:
// the dialect takes an existing Sql, so the two ways of asking are one set of
// connections, one place that knows the URL, and one thing to close.
let queries: Kysely<Database> | undefined

export function useKysely(): Kysely<Database> {
  if (!queries) queries = new Kysely<Database>({ dialect: new PostgresJSDialect({ postgres: useDatabase() }) })
  return queries
}

// The same refusal as requireDatabase, for the routes that build their
// statements rather than write them.
export function requireKysely(): Kysely<Database> {
  if (!hasDatabase()) throw createError({ statusCode: 503, message: 'Storage is not configured on this deployment.' })
  return useKysely()
}

export async function closeDatabase(): Promise<void> {
  const open = pool
  const open_queries = queries
  pool = undefined
  queries = undefined
  // Destroying Kysely ends the postgres.js instance it was handed, so the
  // pool is only ended here when nothing wrapped it.
  if (open_queries) await open_queries.destroy()
  else await open?.end({ timeout: 5 })
}

export { applyMigrations, migrationOrder, type Migration } from '../database/migrate.ts'
