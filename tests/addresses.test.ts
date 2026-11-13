import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApi } from '../src/core/api.ts'
import { generateName, NAME_REGEX, parseName, parseSite } from '../src/core/names.ts'
import { readCredentials, writeCredentials } from '../src/core/credentials.ts'
import { paths } from '../src/core/paths.ts'
import { readRegistry, writeRegistry } from '../src/core/registry.ts'
import {
  adopt,
  create,
  createText,
  list,
  remove,
  reissue,
  route,
  setNote,
  show,
} from '../src/commands/addresses.ts'
import { createRouting } from '../src/core/routing.ts'
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
    if (url.pathname === '/admin/new_address') {
      const { name, domain } = JSON.parse(call.body!) as { name: string; domain: string }
      if (rows.has(`${name}@${domain}`))
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

  test('custom takes the name as given, through the admin API', async () => {
    const server = instance()
    const result = await create(input(['custom', 'Nerea'], { note: 'creator' }), server.context)
    expect(result).toMatchObject({ address: 'nerea@example.com', tier: 'custom', note: 'creator' })
    expect(new URL(server.calls[0]!.url).pathname).toBe('/admin/new_address')
    expect(readCredentials()).toEqual({ 'nerea@example.com': 'jwt-1' })
    expect(await failure(create(input(['custom', 'nerea']), server.context))).toContain(
      '`buzon adopt nerea@example.com`',
    )
  })

  test('custom refuses names the instance would mangle or the cleanup would match', async () => {
    const { context } = instance()
    for (const name of ['ner ea', 'nerea_', '-nerea', 'nerea.', 'a'.repeat(31)]) {
      expect(await failure(create(input(['custom', name]), context))).toContain('custom name')
    }
    expect(await failure(create(input(['custom', 'ste-promo']), context))).toContain('tier prefix')
    expect(await failure(create(input(['custom']), context))).toContain('usage')
    expect(await failure(create(input(['lte', 'nerea']), context))).toContain('usage')
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

const ok = (result: unknown) => json({ success: true, errors: [], result })
const fail = (status: number, message: string) =>
  json({ success: false, errors: [{ code: 1000, message }], result: null }, status)

type CloudflareRule = { id: string; to: string; action: 'worker' | 'forward'; value: string }

/** Email Routing on one zone, `example.org`, as the Cloudflare API answers it. */
function cloudflare() {
  const rules = new Map<string, CloudflareRule>()
  let nextId = 1
  const state = { failCreate: false, failDelete: false }
  const add = (to: string, action: CloudflareRule['action'] = 'worker', value = 'buzon') => {
    const rule = { id: `rule-${nextId++}`, to, action, value }
    rules.set(rule.id, rule)
    return rule
  }
  const raw = (rule: CloudflareRule) => ({
    id: rule.id,
    matchers: [{ type: 'literal', field: 'to', value: rule.to }],
    actions: [{ type: rule.action, value: [rule.value] }],
  })

  const { calls, fetcher } = fake((call) => {
    const url = new URL(call.url)
    if (call.headers.get('authorization') !== 'Bearer cf-token') return fail(401, 'bad token')
    if (url.pathname === '/client/v4/zones') {
      return ok(url.searchParams.get('name') === 'example.org' ? [{ id: 'zone-1' }] : [])
    }
    const base = '/client/v4/zones/zone-1/email/routing/rules'
    if (url.pathname === base && call.method === 'GET') return ok([...rules.values()].map(raw))
    if (url.pathname === base && call.method === 'POST') {
      if (state.failCreate) return fail(500, 'internal error')
      const body = JSON.parse(call.body ?? '') as {
        matchers: { value: string }[]
        actions: { value: string[] }[]
      }
      return ok(raw(add(body.matchers[0]!.value, 'worker', body.actions[0]!.value[0])))
    }
    if (url.pathname.startsWith(`${base}/`) && call.method === 'DELETE') {
      if (state.failDelete) return fail(500, 'internal error')
      const id = url.pathname.split('/').pop()!
      return rules.delete(id) ? ok({ id }) : fail(404, 'not found')
    }
    return fail(404, 'no route')
  })
  return {
    rules,
    add,
    calls,
    state,
    routing: createRouting(
      () => 'cf-token',
      () => 'buzon',
      fetcher,
    ),
  }
}

/** An instance that serves `example.com` and `example.org`, with Email Routing on the second. */
function routedSetup() {
  const server = instance()
  const cf = cloudflare()
  const context = {
    ...server.context,
    config: { ...config, routed: ['example.org'] },
    routing: cf.routing,
  }
  return { server, cf, context }
}

const org = { domain: 'example.org' }

describe('routed domains', () => {
  test('new gives a kept address its rule and says when it receives mail', async () => {
    const { cf, context } = routedSetup()
    const result = await create(input(['custom', 'jane'], org), context)
    expect(result).toMatchObject({ address: 'jane@example.org', ruleId: 'rule-1' })
    expect([...cf.rules.values()]).toEqual([
      { id: 'rule-1', to: 'jane@example.org', action: 'worker', value: 'buzon' },
    ])
    expect(readRegistry().addresses['jane@example.org']!.ruleId).toBe('rule-1')
    expect(createText(result)).toContain('a few minutes')
  })

  test('new on a catch-all domain never calls Cloudflare', async () => {
    const { cf, context } = routedSetup()
    const result = await create(input(['ste']), context)
    expect(result.ruleId).toBeUndefined()
    expect(createText(result)).toBe(result.address)
    expect(cf.calls).toHaveLength(0)
  })

  test('new refuses ste and mte on a routed domain before calling anything', async () => {
    const { server, cf, context } = routedSetup()
    for (const tier of ['ste', 'mte']) {
      expect(await failure(create(input([tier], org), context))).toContain('catch-all domain')
    }
    expect(server.calls).toHaveLength(0)
    expect(cf.calls).toHaveLength(0)
  })

  test('a failed rule keeps the address, and route finishes it', async () => {
    const { cf, context } = routedSetup()
    cf.state.failCreate = true
    const message = await failure(create(input(['lte'], { ...org, site: 'bank' }), context))
    const [address] = Object.keys(readRegistry().addresses)
    expect(message).toContain(`buzon route ${address}`)
    expect(readRegistry().addresses[address!]!.ruleId).toBeUndefined()

    cf.state.failCreate = false
    expect(await route(input([address!]), context)).toEqual({
      routed: [{ address: address!, ruleId: 'rule-1', created: true }],
      conflicts: [],
    })
    expect(readRegistry().addresses[address!]!.ruleId).toBe('rule-1')
  })

  test('route --all records existing rules and reports ones that go elsewhere', async () => {
    const { server, cf, context } = routedSetup()
    server.add('lucia@example.org')
    server.add('contact@example.org')
    server.add('john@example.com')
    const existing = cf.add('lucia@example.org')
    cf.add('contact@example.org', 'forward', 'someone@example.net')
    // `adopt` routes on its own, so the entries are written as an older buzon left them.
    const entry = { tier: 'custom' as const, createdAt: '2026-10-01T12:00:00.000Z', addressId: 1 }
    writeRegistry({
      addresses: {
        'lucia@example.org': entry,
        'contact@example.org': entry,
        'john@example.com': entry,
      },
    })

    const result = await route(input([], { all: true }), context)
    expect(result.routed).toEqual([
      { address: 'lucia@example.org', ruleId: existing.id, created: false },
    ])
    expect(result.conflicts.map((c) => c.address)).toEqual(['contact@example.org'])
    expect(cf.rules.size).toBe(2)
    expect(readRegistry().addresses['lucia@example.org']!.ruleId).toBe(existing.id)
    expect(await failure(route(input(['john@example.com']), context))).toContain('`routed`')
  })

  test('adopt routes an address made elsewhere', async () => {
    const { server, cf, context } = routedSetup()
    server.add('nerea@example.org')
    expect(await adopt(input(['nerea@example.org']), context)).toMatchObject({ ruleId: 'rule-1' })
    expect(cf.rules.get('rule-1')!.to).toBe('nerea@example.org')
  })

  test('delete removes the rule, and a failed removal is finished by a second delete', async () => {
    const { server, cf, context } = routedSetup()
    const jane = await create(input(['custom', 'jane'], org), context)
    cf.state.failDelete = true
    expect(await failure(remove(input([jane.address], { force: true }), context))).toContain(
      'run the same `buzon delete` again',
    )
    expect(server.rows.size).toBe(0)
    expect(readRegistry().addresses[jane.address]).toBeDefined()

    cf.state.failDelete = false
    expect((await remove(input([jane.address], { force: true }), context)).alreadyGone).toBe(true)
    expect(cf.rules.size).toBe(0)
    expect(readRegistry()).toEqual({ addresses: {} })
  })

  test('delete finds the rule of an address routed before buzon recorded it', async () => {
    const { server, cf, context } = routedSetup()
    server.add('lucia@example.org')
    cf.add('lucia@example.org')
    cf.add('contact@example.org', 'forward', 'someone@example.net')
    writeRegistry({
      addresses: {
        'lucia@example.org': {
          tier: 'custom',
          createdAt: '2026-10-01T12:00:00.000Z',
          addressId: 1,
        },
      },
    })
    writeCredentials({ 'lucia@example.org': 'jwt-1' })
    await remove(input(['lucia@example.org'], { force: true }), context)
    expect([...cf.rules.values()].map((rule) => rule.to)).toEqual(['contact@example.org'])
  })
})
