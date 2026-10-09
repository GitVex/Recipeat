import { drainQueue } from '../ingredients/match.ts'
import { lookUpDue } from '../ingredients/lookup.ts'

// Matches saved recipes' lines against the ingredient store (#172), off the
// request path. A save queues its recipe and notifies; this wakes on that, and
// on an interval for a notify that was missed, a pass that failed, or a
// database that was away. After each round, entries cooks made get their
// names and density looked up (#174), on their own so a slow search never
// holds up matching.
export default defineNitroPlugin((nitroApp) => {
  const config = useRuntimeConfig()
  const { ingredientWorkers, ingredientScanMinutes } = config
  if (!ingredientWorkers) return
  let timer: ReturnType<typeof setInterval> | undefined
  let unlisten: (() => Promise<void>) | undefined
  let closed = false

  // One round at a time; a wake-up during a round runs another after it, so
  // a recipe queued just as the workers found the queue empty isn't left.
  let running: Promise<void> | undefined
  let again = false
  const wake = () => {
    if (closed) return
    if (running) { again = true; return }
    running = (async () => {
      do {
        again = false
        const sql = useDatabase()
        // Each worker claims recipes until none is ready; SKIP LOCKED keeps
        // them, and other containers, off each other's.
        const results = await Promise.allSettled(Array.from({ length: ingredientWorkers }, () => drainQueue(sql)))
        for (const result of results) if (result.status === 'rejected') console.error('[ingredients] matching failed', result.reason)
      } while (again && !closed)
      lookUp()
    })().finally(() => { running = undefined })
  }

  // Tries due since the last lookups ran; at start, since a scan ago, so
  // what was made while the app restarted isn't missed.
  let since = new Date(Date.now() - ingredientScanMinutes * 60_000)
  let looking = false
  const lookUp = () => {
    if (looking || closed) return
    looking = true
    lookUpDue(useDatabase(), since, config)
      .then((now) => { since = now })
      .catch(error => console.error('[ingredients] lookups failed', error))
      .finally(() => { looking = false })
  }

  migrated.then(async (ready) => {
    if (!ready || closed) return
    timer = setInterval(wake, ingredientScanMinutes * 60_000)
    wake()
    try {
      ;({ unlisten } = await useDatabase().listen('ingredient_queue', wake))
    } catch (error) {
      // The interval still runs; saves just wait for it.
      console.error('[ingredients] could not listen for saves', error)
    }
  })

  // A round the closing pool cuts off rolls back, and its recipe stays queued.
  nitroApp.hooks.hook('close', async () => {
    closed = true
    clearInterval(timer)
    await unlisten?.().catch(() => {})
  })
})
