import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApi } from '../src/core/api.ts'
import { generateName, NAME_REGEX, parseName, parseSite } from '../src/core/names.ts'
import { readCredentials } from '../src/core/credentials.ts'
import { paths } from '../src/core/paths.ts'
import { readRegistry } from '../src/core/registry.ts'
import { adopt, create, list, remove, reissue, setNote, show } from '../src/commands/addresses.ts'
import { config, failure, fake, json, secrets, type Call } from './fake.ts'

describe('names', () => {
  test('follow the scheme with the UTC month', () => {
    const late = new Date('2026-10-31T23:30:00-02:00')
    expect(generateName('ste', undefined, late, () => 'a1b')).toBe('ste-2611-a1b')
    expect(generateName('lte', 'github', late, () => 'zzz')).toBe('lte-2611-github-zzz')
    for (let i = 0; i < 200; i++) expect(generateName('mte', 'abcdefghijkl')).toMatch(NAME_REGEX)
  })

  test('site rules per tier', () => {
    expect(() => parseSite('ste', 'github')).toThrow('take no --site')
    expect(() => parseSite('lte', 'git-hub')).toThrow('--site must be')
    expect(() => parseSite('mte', 'a'.repeat(13))).toThrow('--site must be')
    expect(parseSite('lte', 'GitHub')).toBe('github')
    expect(parseSite('mte', undefined)).toBeUndefined()
  })

  test('parse back to tier and site, or nothing for a custom name', () => {
    expect(parseName('lte-2610-github-abc')).toEqual({ tier: 'lte', site: 'github' })
    expect(parseName('ste-2610-abc')).toEqual({ tier: 'ste' })
    expect(parseName('john.doe')).toBeUndefined()
  })
})

type Row = { id: number; name: string; created_at: string; jwt: string }

/** An in-memory instance: addresses, their JWTs, and the routes `buzon` calls. */
function instance(options: { taken?: number } = {}) {
  const rows = new Map<string, Row>()
  let nextId = 1
  let taken = options.taken ?? 0
  const add = (name: string, jwt = `jwt-${nextId}`) => {
    const row = { id: nextId++, name, created_at: '2026-10-01 12:00:00', jwt }
    rows.set(name, row)
    return row
  }
  const byJwt = (call: Call) =>
    [...rows.values()].find((row) => `Bearer ${row.jwt}` === call.headers.get('authorization'))

  const { calls, fetcher } = fake((call) => {
    const url = new URL(call.url)
    if (url.pathname === '/api/new_address') {
      const { name, domain } = JSON.parse(call.body!) as { name: string; domain: string }
      if (taken-- > 0)
        return new Response('Failed to create address: Address already exists', { status: 400 })
      const row = add(`${name}@${domain}`)
      return json({ jwt: row.jwt, address: row.name, password: null, address_id: row.id })
    }
    if (url.pathname === '/admin/address') {
      const query = url.searchParams.get('query') ?? ''
      const results = [...rows.values()]
        .filter((row) => row.name.includes(query))
        .map(({ id, name, created_at }) => ({ id, name, created_at }))
      return json({ results, count: results.length })
    }
    if (url.pathname.startsWith('/admin/show_password/')) {
      const id = Number(url.pathname.split('/').pop())
      const row = [...rows.values()].find((r) => r.id === id)!
      row.jwt = `fresh-${id}`
      return json({ jwt: row.jwt })
    }
    const row = byJwt(call)
    if (!row) return new Response('Invalid address credential', { status: 401 })
    if (url.pathname === '/api/delete_address') {
      rows.delete(row.name)
      return json({ success: true })
    }
    if (url.pathname === '/api/mails') return json({ results: [], count: 3 })
    return new Response('not found', { status: 404 })
  })
  return { rows, add, calls, context: { config, api: createApi(config, secrets, fetcher) } }
}

const input = (positionals: string[], flags: Record<string, string | boolean> = {}) => ({
  positionals,
  flags,
})

const saved = { data: process.env.XDG_DATA_HOME, state: process.env.XDG_STATE_HOME }
let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'buzon-addresses-'))
  process.env.XDG_DATA_HOME = join(root, 'data')
  process.env.XDG_STATE_HOME = join(root, 'state')
})

afterEach(() => {
  for (const [key, value] of [
    ['XDG_DATA_HOME', saved.data],
    ['XDG_STATE_HOME', saved.state],
  ] as const) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

/** A directory nothing can be written into, so the next write there fails. */
function readOnly(dir: string) {
  mkdirSync(dir, { recursive: true })
  chmodSync(dir, 0o500)
}

describe('new', () => {
  test('saves the credential owner-only and a secret-free registry entry', async () => {
    const server = instance()
    const result = await create(input(['lte'], { site: 'github', note: 'main' }), server.context)
    expect(result.address).toMatch(/^lte-\d{4}-github-[a-z0-9]{3}@example\.com$/)
    expect(result.token).toBeUndefined()
    expect(readCredentials()).toEqual({ [result.address]: 'jwt-1' })
    expect(statSync(paths.credentials).mode & 0o777).toBe(0o600)
    const entry = readRegistry().addresses[result.address]!
    expect(entry).toMatchObject({ tier: 'lte', site: 'github', note: 'main', addressId: 1 })
    expect(JSON.stringify(readRegistry())).not.toContain('jwt')
  })

  test('--show-token adds the JWT', async () => {
    const result = await create(input(['ste'], { 'show-token': true }), instance().context)
    expect(result.token).toBe('jwt-1')
  })

  test('retries a taken name, up to five tries', async () => {
    const server = instance({ taken: 4 })
    await create(input(['ste']), server.context)
    expect(server.calls).toHaveLength(5)
    expect(await failure(create(input(['ste']), instance({ taken: 5 }).context))).toContain(
      'already exists',
    )
  })

  test('rejects a site on ste and an unknown tier before calling the instance', async () => {
    const server = instance()
    expect(await failure(create(input(['ste'], { site: 'x' }), server.context))).toContain('--site')
    expect(await failure(create(input(['xte']), server.context))).toContain('tier must be')
    expect(server.calls).toHaveLength(0)
  })

  test('a failed registry write reports the orphan and keeps its credential', async () => {
    const server = instance()
    readOnly(paths.registry.replace(/\/registry\.json$/, ''))
    const message = await failure(create(input(['ste']), server.context))
    const [address] = [...server.rows.keys()]
    expect(message).toContain(`buzon adopt ${address}`)
    expect(readCredentials()[address!]).toBe('jwt-1')
  })

  test('a failed credential write reports the orphan, and writes no registry entry', async () => {
    const server = instance()
    readOnly(paths.credentials.replace(/\/credentials\.json$/, ''))
    const message = await failure(create(input(['ste']), server.context))
    expect(message).toContain('credential was not saved')
    expect(message).toContain('buzon adopt')
    expect(readRegistry()).toEqual({ addresses: {} })
  })
})

describe('list, show, note', () => {
  test('filter, inbox count, and note set then cleared', async () => {
    const server = instance()
    const ste = await create(input(['ste']), server.context)
    const lte = await create(input(['lte'], { site: 'shop' }), server.context)
    expect(list(input([], { tier: 'lte' })).map((row) => row.address)).toEqual([lte.address])
    expect(list(input([], { site: 'shop' })).map((row) => row.address)).toEqual([lte.address])
    expect(list(input([]))).toHaveLength(2)

    expect((await show(input([ste.address.split('@')[0]!]), server.context)).mails).toBe(3)

    expect(setNote(input([ste.address, 'signup test']), server.context).note).toBe('signup test')
    expect(setNote(input([ste.address, '']), server.context).note).toBeUndefined()
    expect(readRegistry().addresses[ste.address]!.note).toBeUndefined()
  })
})

describe('delete', () => {
  test('ste goes at once, lte needs --force', async () => {
    const server = instance()
    const ste = await create(input(['ste']), server.context)
    const lte = await create(input(['lte']), server.context)
    expect(await remove(input([ste.address]), server.context)).toEqual({
      address: ste.address,
      alreadyGone: false,
    })
    expect(await failure(remove(input([lte.address]), server.context))).toContain('--force')
    await remove(input([lte.address], { force: true }), server.context)
    expect(server.rows.size).toBe(0)
    expect(readRegistry()).toEqual({ addresses: {} })
    expect(readCredentials()).toEqual({})
  })

  test('refuses an address missing from the registry', async () => {
    const server = instance()
    server.add('ste-2610-abc@example.com')
    expect(await failure(remove(input(['ste-2610-abc']), server.context))).toContain(
      'not in the registry',
    )
    expect(server.rows.size).toBe(1)
  })

  test('an address already gone from the instance is cleaned up locally', async () => {
    const server = instance()
    const ste = await create(input(['ste']), server.context)
    server.rows.clear()
    expect((await remove(input([ste.address]), server.context)).alreadyGone).toBe(true)
    expect(readRegistry()).toEqual({ addresses: {} })
  })

  test('a rejected credential on a live address keeps everything', async () => {
    const server = instance()
    const ste = await create(input(['ste']), server.context)
    server.rows.get(ste.address)!.jwt = 'rotated'
    expect(await failure(remove(input([ste.address]), server.context))).toContain('buzon reissue')
    expect(server.rows.size).toBe(1)
    expect(readRegistry().addresses[ste.address]).toBeDefined()
  })
})

describe('reissue and adopt', () => {
  test('--all mints fresh JWTs and reports addresses gone from the instance', async () => {
    const server = instance()
    const kept = await create(input(['lte']), server.context)
    const gone = await create(input(['ste']), server.context)
    server.rows.delete(gone.address)
    expect(await reissue(input([], { all: true }), server.context)).toEqual({
      reissued: [kept.address],
      missing: [gone.address],
    })
    expect(readCredentials()[kept.address]).toBe('fresh-1')
  })

  test('needs exactly one of an address or --all', async () => {
    const { context } = instance()
    expect(await failure(reissue(input([]), context))).toContain('usage')
    expect(await failure(reissue(input(['a'], { all: true }), context))).toContain('usage')
  })

  test('adopt registers a custom name as custom, and a scheme name by its tier', async () => {
    const server = instance()
    server.add('john@example.com')
    server.add('lte-2610-bank-x1y@example.com')
    const custom = await adopt(input(['john'], { note: 'old' }), server.context)
    expect(custom).toMatchObject({ tier: 'custom', note: 'old', addressId: 1 })
    expect(custom.createdAt).toBe('2026-10-01T12:00:00.000Z')
    expect(await adopt(input(['lte-2610-bank-x1y']), server.context)).toMatchObject({
      tier: 'lte',
      site: 'bank',
    })
    expect(readCredentials()).toEqual({
      'john@example.com': 'fresh-1',
      'lte-2610-bank-x1y@example.com': 'fresh-2',
    })
    expect(await failure(adopt(input(['john']), server.context))).toContain(
      'already in the registry',
    )
    expect(await failure(adopt(input(['nobody']), server.context))).toContain('not on the instance')
  })
})
