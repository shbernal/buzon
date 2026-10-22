import { afterEach, describe, expect, test } from 'bun:test'
import { homedir } from 'node:os'
import { paths } from '../src/core/paths.ts'

const VARS = ['XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME'] as const
const saved = Object.fromEntries(VARS.map((name) => [name, process.env[name]]))

afterEach(() => {
  for (const name of VARS) {
    if (saved[name] === undefined) delete process.env[name]
    else process.env[name] = saved[name]
  }
})

describe('paths', () => {
  test('each file goes under its own XDG base', () => {
    process.env.XDG_CONFIG_HOME = '/x/config'
    process.env.XDG_DATA_HOME = '/x/data'
    process.env.XDG_STATE_HOME = '/x/state'
    process.env.XDG_CACHE_HOME = '/x/cache'
    expect(paths.config).toBe('/x/config/buzon/config.toml')
    expect(paths.wrangler).toBe('/x/config/buzon/wrangler.toml')
    expect(paths.registry).toBe('/x/data/buzon/registry.json')
    expect(paths.credentials).toBe('/x/state/buzon/credentials.json')
    expect(paths.upstream('v1.13.0')).toBe('/x/cache/buzon/upstream/v1.13.0')
  })

  test('unset or relative variables fall back to the spec defaults', () => {
    for (const name of VARS) delete process.env[name]
    process.env.XDG_STATE_HOME = 'relative/state'
    expect(paths.config).toBe(`${homedir()}/.config/buzon/config.toml`)
    expect(paths.registry).toBe(`${homedir()}/.local/share/buzon/registry.json`)
    expect(paths.credentials).toBe(`${homedir()}/.local/state/buzon/credentials.json`)
    expect(paths.upstream('v1')).toBe(`${homedir()}/.cache/buzon/upstream/v1`)
  })
})
