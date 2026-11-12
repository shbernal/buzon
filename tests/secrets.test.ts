import { describe, expect, test } from 'bun:test'
import { findSecret, secret, storeSecret, type Run } from '../src/core/secrets.ts'

const found =
  (value: string, calls: string[][] = []): Run =>
  (argv) => {
    calls.push(argv)
    return { success: true, stdout: `${value}\n` }
  }
const missing: Run = () => ({ success: false, stdout: '' })
const absent: Run = () => {
  throw new Error('ENOENT')
}

describe('secret', () => {
  test('the environment variable wins over the keyring', () => {
    const value = secret('site-password', {
      env: { BUZON_SITE_PASSWORD: 'from-env' },
      platform: 'linux',
      spawn: found('from-keyring'),
    })
    expect(value).toBe('from-env')
  })

  test('reads secret-tool on Linux', () => {
    const calls: string[][] = []
    const value = secret('admin-password', {
      env: {},
      platform: 'linux',
      spawn: found('pw', calls),
    })
    expect(value).toBe('pw')
    expect(calls).toEqual([['secret-tool', 'lookup', 'service', 'buzon', 'key', 'admin-password']])
  })

  test('reads the Keychain on macOS', () => {
    const calls: string[][] = []
    const value = secret('site-password', {
      env: {},
      platform: 'darwin',
      spawn: found('pw', calls),
    })
    expect(value).toBe('pw')
    expect(calls).toEqual([
      ['security', 'find-generic-password', '-s', 'buzon', '-a', 'site-password', '-w'],
    ])
  })

  test('asks for the variable on a platform without a keyring', () => {
    expect(() =>
      secret('site-password', { env: {}, platform: 'win32', spawn: found('pw') }),
    ).toThrow('no site-password: set BUZON_SITE_PASSWORD')
  })

  test('names the store command when the keyring has no entry', () => {
    expect(() => secret('site-password', { env: {}, platform: 'darwin', spawn: missing })).toThrow(
      'security add-generic-password -s buzon -a site-password -w',
    )
  })

  test('names the variable when the keyring tool is not installed', () => {
    expect(() => secret('admin-password', { env: {}, platform: 'linux', spawn: absent })).toThrow(
      'set BUZON_ADMIN_PASSWORD',
    )
  })
})

describe('findSecret', () => {
  test('gives the value, or nothing when it is stored nowhere', () => {
    expect(findSecret('jwt-secret', { env: {}, platform: 'linux', spawn: found('jwt') })).toBe(
      'jwt',
    )
    expect(findSecret('jwt-secret', { env: {}, platform: 'linux', spawn: missing })).toBeUndefined()
    expect(findSecret('jwt-secret', { env: {}, platform: 'win32' })).toBeUndefined()
  })
})

const recorder = (success = true) => {
  const calls: [string[], string | undefined][] = []
  const spawn: Run = (argv, stdin) => {
    calls.push([argv, stdin])
    return { success, stdout: '' }
  }
  return { calls, spawn }
}

describe('storeSecret', () => {
  test('pipes the value to secret-tool on Linux, never through argv', () => {
    const { calls, spawn } = recorder()
    storeSecret('jwt-secret', 's3cret', { platform: 'linux', spawn })
    expect(calls).toEqual([
      [
        [
          'secret-tool',
          'store',
          '--label=buzon jwt-secret',
          'service',
          'buzon',
          'key',
          'jwt-secret',
        ],
        's3cret',
      ],
    ])
  })

  test('feeds the Keychain command to `security -i` on macOS', () => {
    const { calls, spawn } = recorder()
    storeSecret('jwt-secret', 's3cret', { platform: 'darwin', spawn })
    expect(calls[0]![0]).toEqual(['security', '-i'])
    expect(calls[0]![1]).toBe('add-generic-password -U -s buzon -a jwt-secret -w "s3cret"\n')
  })

  test('fails when the keyring refuses or there is none', () => {
    expect(() => storeSecret('jwt-secret', 'x', { platform: 'linux', spawn: missing })).toThrow(
      'could not store the jwt-secret',
    )
    expect(() => storeSecret('jwt-secret', 'x', { platform: 'win32' })).toThrow(
      'set BUZON_JWT_SECRET',
    )
  })
})
