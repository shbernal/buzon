import { describe, expect, test } from 'bun:test'
import { secret, type Run } from '../src/core/secrets.ts'

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
