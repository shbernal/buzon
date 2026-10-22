import { stringFlag, UsageError, type Parsed } from '../core/args.ts'
import { ApiError, createApi, type Api } from '../core/api.ts'
import {
  normalizeDomain,
  normalizeUrl,
  readConfig,
  writeConfig,
  type Config,
} from '../core/config.ts'
import { paths } from '../core/paths.ts'
import { withPrompt } from '../core/prompt.ts'

export const INIT_USAGE =
  'usage: buzon init --url <https://mail.example.com> --domain <example.com>'

export type InitResult = Config & { file: string; version: string }

type OpenSettings = { version?: string; domains?: string[] }

function existing(): Partial<Config> {
  try {
    return readConfig()
  } catch {
    return {}
  }
}

/** Flags win. A missing value is asked on a terminal, and is a usage error elsewhere. */
export async function resolveInput(flags: Parsed['flags'], interactive: boolean): Promise<Config> {
  let url = stringFlag(flags, 'url')
  let domain = stringFlag(flags, 'domain')
  if ((!url || !domain) && !interactive) throw new UsageError(INIT_USAGE)
  if (url && domain) return { url: normalizeUrl(url), domain: normalizeDomain(domain) }
  const current = existing()
  return withPrompt(async (ask) => {
    const normalized = normalizeUrl(url ?? (await ask('Instance URL', current.url)))
    const fallback = current.domain ?? new URL(normalized).hostname
    return {
      url: normalized,
      domain: normalizeDomain(domain ?? (await ask('Mail domain', fallback))),
    }
  })
}

/**
 * `/health_check` is shadowed by the frontend assets on a deploy that serves both, so the
 * public settings route is the probe. A site-only route then checks the site password:
 * `/api/settings` also wants an address JWT, so it cannot tell a wrong password apart.
 */
export async function verify(config: Config, api: Api = createApi(config)): Promise<string> {
  const settings = await api.request<OpenSettings>('/open_api/settings', { anonymous: true })
  if (typeof settings.version !== 'string') {
    throw new Error(`${config.url} does not look like a cloudflare_temp_email instance`)
  }
  if (!settings.domains?.includes(config.domain)) {
    const served = settings.domains?.join(', ') || 'none'
    throw new Error(`${config.url} does not serve ${config.domain} (it serves: ${served})`)
  }
  try {
    await api.request('/user_api/open_settings')
  } catch (error) {
    if (error instanceof ApiError && error.code === 'AUTH_SITE_PASSWORD_INVALID') {
      throw new Error('the instance rejects the site password', { cause: error })
    }
    throw error
  }
  return settings.version
}

/** Nothing is written until the instance answers and accepts the site password. */
export async function init(flags: Parsed['flags'], interactive: boolean): Promise<InitResult> {
  const config = await resolveInput(flags, interactive)
  const version = await verify(config)
  const { tag } = existing()
  writeConfig(tag ? { ...config, tag } : config)
  return { ...config, file: paths.config, version }
}

export function initText(result: InitResult): string {
  return `${result.url} (${result.version}), addresses on ${result.domain}\nwrote ${result.file}`
}
