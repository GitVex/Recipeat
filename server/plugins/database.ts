import { applyMigrations, closeDatabase, hasDatabase, migrationOrder, useDatabase, waitForDatabase, type Migration } from '../utils/database.ts'
import { lowered, type Community } from '../ingredients/community.ts'
import { loadFoods, resolve } from '../ingredients/resolve.ts'

// The ingredient resolver's interval (#147).
const RESOLVE_EVERY_MS = 10 * 60_000

// Migrations run once, at startup, because Coolify rebuilds and restarts a
// resource and gives nothing a per-deploy command to hang a one-shot runner
// on. The app container already starts on every deploy, so this needs no new
// mechanism — at the cost of the two races below.
export default defineNitroPlugin((nitroApp) => {
  const community = useRuntimeConfig().community as Community
  const low = lowered(community)
  if (low.length) console.warn(`[ingredients] below their defaults: ${low.map(name => `${name} = ${community[name]}`).join(', ')}`)

  // Nitro calls plugins without awaiting them, so this cannot be an async
  // plugin: the server would answer requests while the schema was still being
  // written. The promise is kept instead, and every request waits on it.
  let failure: unknown
  const ready = migrate(community).catch((error) => {
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

  // In-process, which assumes one app container, as today. Two would each
  // run it: the resolver's advisory lock keeps them from learning one name
  // twice, but each reloads its own snapshot only on its own tick. More than
  // one needs a shared signal to reload on, or a single runner.
  let timer: ReturnType<typeof setInterval> | undefined
  void ready.then(() => {
    if (failure || !hasDatabase()) return
    timer = setInterval(() => {
      resolve(useDatabase(), community).catch(error => console.error('[ingredients] resolver failed', error))
    }, RESOLVE_EVERY_MS)
  })

  nitroApp.hooks.hook('close', async () => {
    clearInterval(timer)
    await closeDatabase()
  })
})

async function migrate(community: Community): Promise<void> {
  // Nothing to migrate and nothing to fail: the app serves what it can, and
  // the storage routes answer 503 rather than the whole process refusing to
  // start. A deployment cannot reach this — compose.app.yaml requires the URL.
  if (!hasDatabase()) {
    console.warn('[database] NUXT_DATABASE_URL is not set; storage is unavailable, migrations were skipped, and no ingredient will match')
    return
  }

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

  // Inside ready, which every request waits on, so no request is normalized
  // against an empty snapshot. Failing here stops the app like a migration.
  await loadFoods(sql, community)
}
