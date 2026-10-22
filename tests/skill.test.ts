import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { COMMANDS } from '../src/cli.ts'
import { HELP } from '../src/core/help.ts'

const skill = readFileSync(new URL('../skills/buzon/SKILL.md', import.meta.url), 'utf8')

/** Every `buzon …` invocation in code spans and code blocks. */
const invocations = [...skill.matchAll(/`([^`]+)`|```sh\n([\s\S]*?)```/g)]
  .flatMap((match) => (match[1] ?? match[2]!).split('\n'))
  .map((line) => line.replace(/#.*/, '').trim())
  .filter((line) => line.startsWith('buzon '))

test('the skill shows commands', () => {
  expect(invocations.length).toBeGreaterThan(5)
})

test('every command the skill shows exists in the CLI', () => {
  const unknown = invocations
    .map((line) => line.split(/\s+/)[1]!)
    .filter((command) => !(COMMANDS as readonly string[]).includes(command))
  expect(unknown).toEqual([])
})

test('every flag the skill names is in the help', () => {
  const flags = new Set(skill.match(/--[a-z][a-z-]*/g))
  const unknown = [...flags].filter((flag) => !HELP.includes(flag))
  expect(unknown).toEqual([])
})

test('the skill carries the frontmatter that skills add expects', () => {
  const frontmatter = /^---\n([\s\S]*?)\n---/.exec(skill)?.[1] ?? ''
  expect(frontmatter).toMatch(/^name: buzon$/m)
  expect(frontmatter).toMatch(/^description: \S/m)
})
