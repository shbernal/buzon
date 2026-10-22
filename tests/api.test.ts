import { describe, expect, test } from 'bun:test'
import { ApiError, createApi } from '../src/core/api.ts'
import { verify } from '../src/commands/init.ts'
import { config, failure, fake, json, secrets, type Call } from './fake.ts'

describe('api', () => {
  test('sends the site password, the JWT and, for /admin, the admin password', async () => {
    const { calls, fetcher } = fake(() => json({}))
    const api = createApi(config, secrets, fetcher)
    await api.request('/api/mails', { jwt: 'token' })
    await api.request('/admin/address', { body: { a: 1 } })
    expect(calls[0]!.url).toBe('https://mail.example.com/api/mails')
    expect(calls[0]!.headers.get('x-custom-auth')).toBe('site')
    expect(calls[0]!.headers.get('authorization')).toBe('Bearer token')
    expect(calls[0]!.headers.get('x-admin-auth')).toBeNull()
    expect(calls[1]!.method).toBe('POST')
    expect(calls[1]!.headers.get('x-admin-auth')).toBe('admin')
    expect(calls[1]!.body).toBe('{"a":1}')
  })

  test('maps text and JSON error bodies to ApiError', async () => {
    const { fetcher } = fake((call) =>
      call.url.endsWith('/text')
        ? new Response('Invalid address credential', { status: 401 })
        : json({ code: 'AUTH_SITE_PASSWORD_INVALID', message: 'bad password' }, 401),
    )
    const api = createApi(config, secrets, fetcher)
    const text = await api.request('/text').catch((error: unknown) => error)
    expect(text).toBeInstanceOf(ApiError)
    expect((text as ApiError).status).toBe(401)
    expect((text as ApiError).message).toBe('/text: 401 Invalid address credential')
    const coded = await api.request('/coded').catch((error: unknown) => error)
    expect((coded as ApiError).code).toBe('AUTH_SITE_PASSWORD_INVALID')
  })

  test('an HTML page where JSON was expected is an error', async () => {
    const { fetcher } = fake(
      () => new Response('<!DOCTYPE html>', { headers: { 'content-type': 'text/html' } }),
    )
    expect(await failure(createApi(config, secrets, fetcher).request('/health_check'))).toContain(
      'expected JSON',
    )
  })
})

const instance = (site: (call: Call) => Response) =>
  fake((call) =>
    call.url.endsWith('/open_api/settings')
      ? json({ version: 'v1.13.0', domains: ['example.com'] })
      : site(call),
  )

describe('init verify', () => {
  test('passes with a served domain and an accepted site password', async () => {
    const { calls, fetcher } = instance(() => json({ oauth2ClientIDs: [] }))
    expect(await verify(config, createApi(config, secrets, fetcher))).toBe('v1.13.0')
    expect(calls[0]!.headers.get('x-custom-auth')).toBeNull()
    expect(calls[1]!.headers.get('x-custom-auth')).toBe('site')
  })

  test('fails on a domain the instance does not serve', async () => {
    const { fetcher } = instance(() => json({}))
    const other = { ...config, domain: 'other.example.org' }
    expect(await failure(verify(other, createApi(other, secrets, fetcher)))).toContain(
      'does not serve other.example.org',
    )
  })

  test('fails on a rejected site password', async () => {
    const { fetcher } = instance(() =>
      json({ code: 'AUTH_SITE_PASSWORD_INVALID', message: 'no' }, 401),
    )
    expect(await failure(verify(config, createApi(config, secrets, fetcher)))).toContain(
      'rejects the site password',
    )
  })
})
