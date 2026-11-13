import { expect, test } from 'bun:test'
import { createRouting } from '../src/core/routing.ts'
import { failure, fake, json } from './fake.ts'

const ok = (result: unknown, total_pages = 1) =>
  json({ success: true, errors: [], result, result_info: { total_pages } })

const rule = (id: string, to: string) => ({
  id,
  matchers: [{ type: 'literal', field: 'to', value: to }],
  actions: [{ type: 'worker', value: ['buzon'] }],
})

test('looks the zone up once and reads every page of rules', async () => {
  const { calls, fetcher } = fake((call) => {
    const url = new URL(call.url)
    if (url.pathname.endsWith('/zones')) return ok([{ id: 'zone-1' }])
    const page = Number(url.searchParams.get('page'))
    const rules = Array.from({ length: page === 1 ? 50 : 1 }, (_, i) =>
      rule(`r${page}-${i}`, `A${page}-${i}@example.org`),
    )
    return ok(rules, 2)
  })
  const routing = createRouting(
    () => 'token',
    () => 'buzon',
    fetcher,
  )
  const rules = await routing.rules('example.org')
  expect(rules).toHaveLength(51)
  expect(rules[0]).toEqual({ id: 'r1-0', to: 'a1-0@example.org', worker: 'buzon' })
  await routing.rules('example.org')
  expect(calls.filter((call) => call.url.includes('/zones?'))).toHaveLength(1)
})

test('leaves out what a rule matches or does beyond one address and one Worker', async () => {
  const { fetcher } = fake((call) =>
    call.url.includes('/zones?')
      ? ok([{ id: 'zone-1' }])
      : ok([
          { id: 'all', matchers: [{ type: 'all' }], actions: [{ type: 'drop' }] },
          {
            id: 'fwd',
            matchers: [{ type: 'literal', field: 'to', value: 'a@example.org' }],
            actions: [{ type: 'forward', value: ['b@example.net'] }],
          },
        ]),
  )
  const rules = await createRouting(
    () => 'token',
    () => 'buzon',
    fetcher,
  ).rules('example.org')
  expect(rules).toEqual([{ id: 'all' }, { id: 'fwd', to: 'a@example.org' }])
})

test('says which zone the token cannot see, and passes on Cloudflare errors', async () => {
  const { fetcher } = fake((call) =>
    call.url.includes('/zones?')
      ? ok([])
      : json({ success: false, errors: [{ code: 10000, message: 'Authentication error' }] }, 403),
  )
  const routing = createRouting(
    () => 'token',
    () => 'buzon',
    fetcher,
  )
  expect(await failure(routing.rules('example.org'))).toContain('sees no zone example.org')

  const denied = fake(() =>
    json({ success: false, errors: [{ code: 10000, message: 'Authentication error' }] }, 403),
  )
  const refused = createRouting(
    () => 'token',
    () => 'buzon',
    denied.fetcher,
  )
  expect(await failure(refused.rules('example.org'))).toContain('403 Authentication error')
})

test('reads the token only when a request goes out', async () => {
  let reads = 0
  const routing = createRouting(
    () => {
      reads++
      return 'token'
    },
    () => 'buzon',
    fake(() => ok([{ id: 'zone-1' }])).fetcher,
  )
  expect(reads).toBe(0)
  await routing.rules('example.org')
  await routing.rules('example.org')
  expect(reads).toBe(1)
})
