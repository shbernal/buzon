import type { Config } from './config.ts'
import { secret as keyringSecret, type SecretKey } from './secrets.ts'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    message: string,
    /** Upstream error code, when the body was `{ code, message }` JSON instead of text. */
    readonly code?: string,
    /** Seconds from a `Retry-After` header, on a 429. */
    readonly retryAfter?: number,
  ) {
    super(`${path}: ${status} ${message}`)
  }
}

export type RequestOptions = {
  method?: string
  body?: unknown
  /** Address JWT, sent as a bearer token. `/api/*` routes need one, except a few public ones. */
  jwt?: string
  /** Leave the site password out, for a probe that must not depend on it. */
  anonymous?: boolean
}

export type Api = {
  request<T>(path: string, options?: RequestOptions): Promise<T>
}

/**
 * Upstream answers errors as plain text, or as `{ code, message }` JSON for auth failures.
 * Both become an `ApiError` with the status kept.
 */
async function failure(response: Response, path: string): Promise<ApiError> {
  const text = (await response.text()).trim()
  const retry = Number(response.headers.get('retry-after') ?? Number.NaN)
  const retryAfter = Number.isFinite(retry) && retry >= 0 ? retry : undefined
  try {
    const body = JSON.parse(text) as { code?: unknown; message?: unknown }
    if (typeof body.message === 'string') {
      return new ApiError(
        response.status,
        path,
        body.message,
        typeof body.code === 'string' ? body.code : undefined,
        retryAfter,
      )
    }
  } catch {}
  return new ApiError(response.status, path, text || response.statusText, undefined, retryAfter)
}

/** Secrets are read on first use, so a command that never calls `/admin/*` never needs one. */
export function createApi(
  config: Pick<Config, 'url'>,
  secret: (key: SecretKey) => string = keyringSecret,
  fetcher: typeof fetch = fetch,
): Api {
  const cached = new Map<SecretKey, string>()
  const get = (key: SecretKey) => {
    let value = cached.get(key)
    if (value === undefined) {
      value = secret(key)
      cached.set(key, value)
    }
    return value
  }

  return {
    async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
      const headers = new Headers({ accept: 'application/json' })
      if (!options.anonymous) headers.set('x-custom-auth', get('site-password'))
      if (options.jwt) headers.set('authorization', `Bearer ${options.jwt}`)
      if (path.startsWith('/admin/')) headers.set('x-admin-auth', get('admin-password'))
      let body: string | undefined
      if (options.body !== undefined) {
        headers.set('content-type', 'application/json')
        body = JSON.stringify(options.body)
      }

      let response: Response
      try {
        response = await fetcher(`${config.url}${path}`, {
          method: options.method ?? (body === undefined ? 'GET' : 'POST'),
          headers,
          body,
        })
      } catch (error) {
        throw new Error(`${config.url}${path}: request failed`, { cause: error })
      }
      if (!response.ok) throw await failure(response, path)

      const text = await response.text()
      if (!response.headers.get('content-type')?.includes('application/json')) {
        throw new ApiError(response.status, path, 'expected JSON, got something else')
      }
      return JSON.parse(text) as T
    },
  }
}
