import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VALUE_FLAGS } from '../src/core/args.ts'
import { COMMANDS } from '../src/cli.ts'
import { COMMAND_FLAGS, complete, type Sources } from '../src/core/complete.ts'
import { HELP } from '../src/core/help.ts'

const sources: Sources = {
  addresses: () => ['lte-2610-github-a1b@example.com', 'ste-2610-9qa@example.com'],
  sites: () => ['github'],
  domains: () => ['example.com'],
}

const run = (...words: string[]) => complete(words, sources)

describe('complete', () => {
  test('commands first, then each command its own positionals', () => {
    expect(run('')).toContain('wait')
    expect(run('-')).toEqual(['--help', '--version'])
    expect(run('new', '')).toEqual(['ste', 'mte', 'lte', 'custom'])
    expect(run('wait', '')).toEqual(sources.addresses())
    expect(run('wait', 'ste-2610-9qa@example.com', '')).toEqual([])
    expect(run('secrets', '')).toEqual(['push'])
    expect(run('completion', '')).toEqual(['bash', 'zsh', 'fish'])
    expect(run('adopt', '')).toEqual([])
  })

  test('flags of the command, and values after a flag that takes one', () => {
    expect(run('wait', 'x', '--')).toEqual([
      '--code',
      '--link',
      '--from',
      '--subject',
      '--timeout',
      '--since',
      '--json',
      '--help',
    ])
    expect(run('list', '--tier', '')).toEqual(['ste', 'mte', 'lte', 'custom'])
    expect(run('new', 'lte', '--site', '')).toEqual(['github'])
    expect(run('new', '--domain', '')).toEqual(['example.com'])
    expect(run('wait', '--timeout', '')).toEqual([])
  })

  test('a flag value is not taken for the command or an address', () => {
    expect(run('--json', 'wait', '')).toEqual(sources.addresses())
    expect(run('list', '--site', 'github', '--tier', '')).toEqual(['ste', 'mte', 'lte', 'custom'])
    expect(run('new', '--site', 'github', '')).toEqual(['ste', 'mte', 'lte', 'custom'])
  })

  test('--flag=value as one word, and as bash splits it', () => {
    expect(run('list', '--tier=')).toEqual([
      '--tier=ste',
      '--tier=mte',
      '--tier=lte',
      '--tier=custom',
    ])
    expect(run('list', '--tier', '=', '')).toEqual(['ste', 'mte', 'lte', 'custom'])
  })

  test('the flag table matches the help text and the parser', () => {
    expect(Object.keys(COMMAND_FLAGS).toSorted()).toEqual([...COMMANDS].toSorted())
    const listed = new Set(Object.values(COMMAND_FLAGS).flat())
    for (const flag of VALUE_FLAGS) expect(listed).toContain(flag)
    const inHelp = new Set(HELP.match(/--[a-z][a-z-]*/g)!.map((flag) => flag.slice(2)))
    for (const flag of listed) expect(inHelp).toContain(flag)
    for (const flag of inHelp) expect([...listed, 'json', 'help', 'version']).toContain(flag)
  })
})

test('__complete reads addresses from the registry', async () => {
  const data = mkdtempSync(join(tmpdir(), 'buzon-complete-'))
  await Bun.write(
    join(data, 'buzon', 'registry.json'),
    JSON.stringify({ addresses: { 'jane@example.com': { tier: 'custom', addressId: 1 } } }),
  )
  const proc = Bun.spawn(['bun', 'bin/buzon', '__complete', 'show', ''], {
    cwd: `${import.meta.dir}/..`,
    env: { ...process.env, XDG_DATA_HOME: data },
  })
  expect(await new Response(proc.stdout).text()).toBe('jane@example.com\n')
})
