import { applyMigrations, closeDatabase, migrationOrder, useDatabase, waitForDatabase, type Migration } from '../utils/database.ts'

// Migrations run once, at startup, because Coolify rebuilds and restarts a
// resource and gives nothing a per-deploy command to hang a one-shot runner
// on. The app container already starts on every deploy, so this needs no new
// mechanism — at the cost of the two races below.
export default defineNitroPlugin((nitroApp) => {
  // Nitro calls plugins without awaiting them, so this cannot be an async
  // plugin: the server would answer requests while the schema was still being
  // written. The promise is kept instead, and every request waits on it.
  let failure: unknown
  const ready = migrate().catch((error) => {
    failure = error
    console.error('[database] migrations failed', error)
    // A half-migrated schema answering requests is worse than a container that
    // will not start: the restart is visible, a schema half a column short is
    // not. In dev the process is the editor's, so it stays up and every
    // request says why instead.
    if (!import.meta.dev) process.exit(1)
  })

  nitroApp.hooks.hook('request', async () => {
    await ready
    if (failure) throw createError({ statusCode: 503, statusMessage: 'Database migrations failed' })
  })

  nitroApp.hooks.hook('close', closeDatabase)
})

async function migrate(): Promise<void> {
  // Server assets rather than a directory read: at runtime the built output is
  // all there is — server/ does not survive the image — and an asset is
  // bundled into it. The same read works in dev, where it is the directory.
  const files = useStorage('assets:migrations')
  const versions = migrationOrder(await files.getKeys())
  const migrations: Migration[] = []
  for (const version of versions) {
    const sql = await files.getItem<string>(version)
    if (typeof sql !== 'string') throw new Error(`Migration ${version} could not be read`)
    migrations.push({ version, sql })
  }

  const sql = useDatabase()
  await waitForDatabase(sql)
  const applied = await applyMigrations(sql, migrations)
  // Silence when there was nothing to do: every restart of an unchanged
  // deployment passes through here.
  if (applied.length > 0) console.info(`[database] applied ${applied.join(', ')}`)
}
