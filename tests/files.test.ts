import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readJson, writeAtomic, writeJson } from '../src/core/files.ts'
import { readCredentials, writeCredentials } from '../src/core/credentials.ts'
import { readRegistry, writeRegistry } from '../src/core/registry.ts'

const dir = () => mkdtempSync(join(tmpdir(), 'buzon-files-'))
const mode = (file: string) => statSync(file).mode & 0o777

describe('atomic writes', () => {
  test('creates missing directories and leaves no temp file behind', () => {
    const root = dir()
    const file = join(root, 'a', 'b', 'value.json')
    writeJson(file, { ok: true })
    expect(readJson(file)).toEqual({ ok: true })
    expect(readdirSync(join(root, 'a', 'b'))).toEqual(['value.json'])
  })

  test('replaces an existing file whole', () => {
    const file = join(dir(), 'value.txt')
    writeAtomic(file, 'first, and longer\n')
    writeAtomic(file, 'second\n')
    expect(readFileSync(file, 'utf8')).toBe('second\n')
  })

  test('credentials are owner-only, even over a looser file', () => {
    const file = join(dir(), 'credentials.json')
    writeFileSync(file, '{}', { mode: 0o644 })
    writeCredentials({ 'a@example.com': 'jwt' }, file)
    expect(mode(file)).toBe(0o600)
    expect(readCredentials(file)).toEqual({ 'a@example.com': 'jwt' })
  })

  test('the registry is a plain file', () => {
    const file = join(dir(), 'registry.json')
    const registry = { addresses: { 'a@example.com': { createdAt: '2026-01-01T00:00:00.000Z' } } }
    writeRegistry(registry, file)
    expect(mode(file)).toBe(0o644)
    expect(readRegistry(file)).toEqual(registry)
  })

  test('a missing file reads as empty, a damaged one throws', () => {
    const root = dir()
    expect(readRegistry(join(root, 'absent.json'))).toEqual({ addresses: {} })
    expect(readCredentials(join(root, 'absent.json'))).toEqual({})
    const broken = join(root, 'broken.json')
    writeFileSync(broken, '{')
    expect(() => readJson(broken)).toThrow('not valid JSON')
  })
})
