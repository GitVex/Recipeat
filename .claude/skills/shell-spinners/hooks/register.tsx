import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Shell } from '../types'

const PANE = 'shells'
const TITLE = 'Shells'
const FRAMES = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
const TICK_MS = 100

const shells = atom({ plugin: 'shell-spinners', key: 'shells' } as const, [])
const frame = atom({ plugin: 'shell-spinners', key: 'frame' } as const, 0)

// The call's description when Claude gave one, else the command's first line.
export const titleOf = (call: { command: string; description?: string }) =>
  (call.description || call.command).split('\n')[0]!.trim()

// A task notification names the task's id in its text, so every shell it names has ended.
export const without = (list: readonly Shell[], notification: string) => list.filter(s => !notification.includes(s.id))

let spinner: Timer | undefined

// Spins while a shell runs, and stops redrawing once none does.
async function sync($: EngineInterface, list: readonly Shell[]) {
  if (list.length > 0 && !spinner) {
    spinner = $.clock.every(TICK_MS, () => update($, frame, f => (f + 1) % FRAMES.length))
    // Unasked, the pane only seats from 144 columns; /shells opens it at any width.
    void $.ui.open({ id: PANE, title: TITLE })
  } else if (list.length === 0 && spinner) {
    spinner.cancel()
    spinner = undefined
    await $.ui.close({ id: PANE })
  }
}

async function set($: EngineInterface, fn: (list: readonly Shell[]) => Shell[]) {
  await update($, shells, fn)
  await sync($, await read($, shells))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'shells', description: 'Show the running background shells in a pane' })
    // A reload starts the module over; pick the spinner back up for shells still listed.
    await sync($, await read($, shells))
    return next(e)
  })

  on('command.run', { command: 'shells' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'Shells pane opened.' }
  })

  on('tool.call', async ($, e, next) => {
    if (e.tool !== 'Bash' && e.tool !== 'PowerShell') return next(e)
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError) return ran
    // Set when the call ran in the background from the start, or was moved there with ctrl+b.
    const id = ran.result?.backgroundTaskId
    if (id) await set($, list => [...list, { id, title: titleOf(e) }])
    return ran
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'task-notification') await set($, list => without(list, e.text))
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, shells)
    const spin = FRAMES[await read($, frame)]

    return (
      <Box flexDirection="column">
        {list.length === 0 && <Text color="subtle">No shells running.</Text>}
        {list.map(s => (
          <Text wrap="truncate-end">
            <Text color="warning">{spin}</Text>
            <Text color="subtle"> {s.title}</Text>
          </Text>
        ))}
      </Box>
    )
  })
}
