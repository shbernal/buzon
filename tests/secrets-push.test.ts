import { describe, expect, test } from 'bun:test'
import { pushSecrets, type SecretsDeps } from '../src/commands/secrets.ts'
import type { SecretKey } from '../src/core/secrets.ts'
import type { Wrangler } from '../src/core/upstream.ts'
import { failure, secrets } from './fake.ts'

type WranglerCall = { args: string[]; input?: string }

/** A `wrangler` stub that records every call and answers `output` calls from `outputs`. */
function fakeWrangler(outputs: Record<string, string> = {}) {
  const calls: WranglerCall[] = []
  const wrangler: Wrangler = {
    run: async (args, input) => {
      calls.push(input === undefined ? { args } : { args, input })
    },
    output: async (args) => {
      calls.push({ args })
      return outputs[args.join(' ')] ?? ''
    },
  }
  return { calls, wrangler }
}

/** A keyring holding the two passwords, and a JWT secret when `jwt` is given. */
function keyring(jwt?: string) {
  const stored = new Map<SecretKey, string>()
  if (jwt) stored.set('jwt-secret', jwt)
  const deps: SecretsDeps = {
    read: secrets,
    find: (key) => stored.get(key),
    store: (key, value) => void stored.set(key, value),
    generate: () => 'fresh',
    env: {},
  }
  return { stored, deps }
}

const noAdmin = (key: SecretKey) => {
  if (key === 'admin-password') throw new Error('no admin-password')
  return 'site'
}

describe('secrets push', () => {
  test('sends the passwords as JSON lists on stdin, and the stored JWT secret', async () => {
    const { calls, wrangler } = fakeWrangler()
    const result = await pushSecrets(wrangler, 'keep', keyring('kept').deps)
    expect(calls).toEqual([
      { args: ['secret', 'put', 'JWT_SECRET'], input: 'kept' },
      { args: ['secret', 'put', 'PASSWORDS'], input: '["site"]' },
      { args: ['secret', 'put', 'ADMIN_PASSWORDS'], input: '["admin"]' },
    ])
    expect(result).toEqual({
      pushed: ['JWT_SECRET', 'PASSWORDS', 'ADMIN_PASSWORDS'],
      jwt: 'pushed',
    })
  })

  test('escapes a password that needs it', async () => {
    const { calls, wrangler } = fakeWrangler()
    const deps = { ...keyring().deps, read: () => 'a"b\\c' }
    await pushSecrets(wrangler, 'keep', deps)
    expect(JSON.parse(calls[0]!.input!)).toEqual(['a"b\\c'])
  })

  test('leaves the Worker JWT secret alone when none is stored', async () => {
    const { calls, wrangler } = fakeWrangler()
    const { stored, deps } = keyring()
    const result = await pushSecrets(wrangler, 'keep', deps)
    expect(calls.map((call) => call.args[2])).toEqual(['PASSWORDS', 'ADMIN_PASSWORDS'])
    expect(result.jwt).toBe('kept')
    expect(stored.has('jwt-secret')).toBe(false)
  })

  test('rotating replaces the stored one', async () => {
    const { calls, wrangler } = fakeWrangler()
    const { stored, deps } = keyring('old')
    expect((await pushSecrets(wrangler, 'rotate', deps)).jwt).toBe('rotated')
    expect(stored.get('jwt-secret')).toBe('fresh')
    expect(calls[0]!.input).toBe('fresh')
  })

  test('rotating refuses while BUZON_JWT_SECRET would override the new one', async () => {
    const { calls, wrangler } = fakeWrangler()
    const deps = { ...keyring().deps, env: { BUZON_JWT_SECRET: 'pinned' } }
    expect(await failure(pushSecrets(wrangler, 'rotate', deps))).toContain('unset BUZON_JWT_SECRET')
    expect(calls).toEqual([])
  })

  test('a missing password stops it before anything is pushed', async () => {
    const { calls, wrangler } = fakeWrangler()
    const { stored, deps } = keyring()
    expect(await failure(pushSecrets(wrangler, 'rotate', { ...deps, read: noAdmin }))).toBe(
      'no admin-password',
    )
    expect(calls).toEqual([])
    expect(stored.size).toBe(0)
  })
})
