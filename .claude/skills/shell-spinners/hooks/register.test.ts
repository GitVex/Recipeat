import { expect, test } from 'claude-code/testing'

import { titleOf, without } from './register'

test('titles a shell by its description, else the first line of its command', () => {
  expect(titleOf({ command: 'npm run dev', description: 'Start dev server' })).toBe('Start dev server')
  expect(titleOf({ command: '  npm test\n  && echo done' })).toBe('npm test')
  expect(titleOf({ command: 'npm test', description: '' })).toBe('npm test')
})

test('drops the shells a task notification names', () => {
  const list = [
    { id: 'b1x9', title: 'dev server' },
    { id: 'k7q2', title: 'tests' },
  ]
  const text = '<task-notification><task-id>k7q2</task-id><status>completed</status></task-notification>'
  expect(without(list, text)).toEqual([{ id: 'b1x9', title: 'dev server' }])
  expect(without(list, 'an unrelated notification')).toEqual(list)
})
