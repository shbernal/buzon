import { homedir } from 'node:os'
import { join } from 'node:path'

type Kind = 'config' | 'data' | 'state' | 'cache'

const XDG: Record<Kind, [variable: string, fallback: string]> = {
  config: ['XDG_CONFIG_HOME', '.config'],
  data: ['XDG_DATA_HOME', join('.local', 'share')],
  state: ['XDG_STATE_HOME', join('.local', 'state')],
  cache: ['XDG_CACHE_HOME', '.cache'],
}

/** The XDG spec ignores a relative value, so a relative variable falls back like an unset one. */
function dir(kind: Kind): string {
  const [variable, fallback] = XDG[kind]
  const value = process.env[variable]
  const base = value?.startsWith('/') ? value : join(homedir(), fallback)
  return join(base, 'buzon')
}

export const paths = {
  get configDir() {
    return dir('config')
  },
  get config() {
    return join(dir('config'), 'config.toml')
  },
  get wrangler() {
    return join(dir('config'), 'wrangler.toml')
  },
  get registry() {
    return join(dir('data'), 'registry.json')
  },
  get credentials() {
    return join(dir('state'), 'credentials.json')
  },
  upstream(tag: string) {
    return join(dir('cache'), 'upstream', tag)
  },
}
