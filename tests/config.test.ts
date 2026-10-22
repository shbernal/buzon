import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ConfigMissingError,
  parseConfig,
  readConfig,
  serializeConfig,
  writeConfig,
} from '../src/core/config.ts'

const dir = () => mkdtempSync(join(tmpdir(), 'buzon-config-'))

describe('config', () => {
  test('round-trips through TOML', () => {
    const file = join(dir(), 'config.toml')
    const config = { url: 'https://mail.example.com', domain: 'example.com' }
    writeConfig(config, file)
    expect(readConfig(file)).toEqual(config)
  })

  test('normalizes the URL to its origin and the domain to lower case', () => {
    const text = 'url = "https://Mail.Example.com/some/path/"\ndomain = "Example.COM"\n'
    expect(parseConfig(text)).toEqual({ url: 'https://mail.example.com', domain: 'example.com' })
  })

  test('quotes values TOML can read back', () => {
    expect(serializeConfig({ url: 'https://mail.example.com', domain: 'example.com' })).toBe(
      'url = "https://mail.example.com"\ndomain = "example.com"\n',
    )
  })

  test('a missing file points to buzon init', () => {
    const file = join(dir(), 'absent.toml')
    expect(() => readConfig(file)).toThrow(ConfigMissingError)
    expect(() => readConfig(file)).toThrow('buzon init')
  })

  test('rejects missing keys, bad URLs and bad TOML', () => {
    expect(() => parseConfig('domain = "example.com"\n')).toThrow('`url` is missing')
    expect(() => parseConfig('url = "https://mail.example.com"\n')).toThrow('`domain` is missing')
    expect(() => parseConfig('url = "ftp://x.example.com"\ndomain = "example.com"\n')).toThrow(
      'not an http(s) URL',
    )
    expect(() => parseConfig('url = "https://mail.example.com"\ndomain = "no_dots"\n')).toThrow(
      'not a domain',
    )
    const file = join(dir(), 'broken.toml')
    writeFileSync(file, 'url = \n')
    expect(() => readConfig(file)).toThrow('not valid TOML')
  })
})
