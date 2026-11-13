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

  test('keeps the routed domains, normalized, and rejects anything but a list of them', () => {
    const file = join(dir(), 'config.toml')
    writeConfig({ url: 'https://mail.example.com', domain: 'example.com', routed: [] }, file)
    expect(readConfig(file).routed).toBeUndefined()
    const base = 'url = "https://mail.example.com"\ndomain = "example.com"\n'
    expect(parseConfig(`${base}routed = ["Example.ORG"]\n`).routed).toEqual(['example.org'])
    const config = {
      url: 'https://mail.example.com',
      domain: 'example.com',
      routed: ['example.org'],
    }
    writeConfig(config, file)
    expect(readConfig(file)).toEqual(config)
    expect(() => parseConfig(`${base}routed = "example.org"\n`)).toThrow('list of domains')
    expect(() => parseConfig(`${base}routed = ["no_dots"]\n`)).toThrow('not a domain')
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

  test('keeps the deployed tag, and rejects one that is not a release', () => {
    const file = join(dir(), 'config.toml')
    const config = { url: 'https://mail.example.com', domain: 'example.com', tag: 'v1.13.0' }
    writeConfig(config, file)
    expect(readConfig(file)).toEqual(config)
    const base = 'url = "https://mail.example.com"\ndomain = "example.com"\n'
    expect(() => parseConfig(`${base}tag = "main"\n`)).toThrow('not a release tag')
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
