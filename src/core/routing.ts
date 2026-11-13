import { ApiError } from './api.ts'
import { domainOf } from './names.ts'

const BASE = 'https://api.cloudflare.com/client/v4'

/** The largest page the rules endpoint serves. */
const PER_PAGE = 50

/** An Email Routing rule, reduced to what buzon matches on. */
export type Rule = {
  id: string
  /** The address of a single literal `to` matcher, lowercased. Absent on any other rule. */
  to?: string
  /** The Worker of a single `worker` action. Absent on any other rule. */
  worker?: string
}

type RawRule = {
  id: string
  matchers?: { type?: string; field?: string; value?: string }[]
  actions?: { type?: string; value?: string[] }[]
}

type Envelope<T> = {
  success: boolean
  errors?: { code?: number; message?: string }[]
  result: T
  result_info?: { total_pages?: number }
}

/** Email Routing on the zones buzon routes address by address. */
export type Routing = {
  /** The Worker that receives the mail, as `wrangler.toml` names it. */
  worker(): string
  rules(domain: string): Promise<Rule[]>
  create(address: string): Promise<string>
  /** `false` when the rule was already gone. */
  remove(domain: string, id: string): Promise<boolean>
}

function reduce(raw: RawRule): Rule {
  const rule: Rule = { id: raw.id }
  const [matcher, ...moreMatchers] = raw.matchers ?? []
  if (
    matcher?.type === 'literal' &&
    matcher.field === 'to' &&
    matcher.value &&
    !moreMatchers.length
  )
    rule.to = matcher.value.toLowerCase()
  const [action, ...moreActions] = raw.actions ?? []
  if (action?.type === 'worker' && action.value?.length === 1 && !moreActions.length)
    rule.worker = action.value[0]
  return rule
}

/** The token and the Worker name are read on first use, so a catch-all setup never needs them. */
export function createRouting(
  token: () => string,
  worker: () => string,
  fetcher: typeof fetch = fetch,
): Routing {
  const zones = new Map<string, string>()
  let bearer: string | undefined

  async function request<T>(path: string, method = 'GET', body?: unknown) {
    const headers = new Headers({
      authorization: `Bearer ${(bearer ??= token())}`,
      accept: 'application/json',
    })
    if (body !== undefined) headers.set('content-type', 'application/json')
    let response: Response
    try {
      response = await fetcher(`${BASE}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch (error) {
      throw new Error(`Cloudflare ${path}: request failed`, { cause: error })
    }
    let envelope: Envelope<T> | undefined
    try {
      envelope = (await response.json()) as Envelope<T>
    } catch {}
    if (!response.ok || !envelope?.success) {
      const first = envelope?.errors?.[0]
      throw new ApiError(
        response.status,
        `Cloudflare ${path}`,
        first?.message ?? response.statusText,
        first?.code === undefined ? undefined : String(first.code),
      )
    }
    return envelope
  }

  async function zone(domain: string): Promise<string> {
    let id = zones.get(domain)
    if (!id) {
      const { result } = await request<{ id: string }[]>(
        `/zones?${new URLSearchParams({ name: domain }).toString()}`,
      )
      id = result[0]?.id
      if (!id) throw new Error(`the Cloudflare token sees no zone ${domain}`)
      zones.set(domain, id)
    }
    return id
  }

  return {
    worker,
    async rules(domain) {
      const base = `/zones/${await zone(domain)}/email/routing/rules`
      const out: Rule[] = []
      for (let page = 1; ; page++) {
        const params = new URLSearchParams({ page: String(page), per_page: String(PER_PAGE) })
        const { result, result_info } = await request<RawRule[]>(`${base}?${params.toString()}`)
        out.push(...result.map(reduce))
        if (page >= (result_info?.total_pages ?? 1) || result.length < PER_PAGE) return out
      }
    },
    async create(address) {
      const base = `/zones/${await zone(domainOf(address))}/email/routing/rules`
      const { result } = await request<RawRule>(base, 'POST', {
        name: address,
        enabled: true,
        matchers: [{ type: 'literal', field: 'to', value: address }],
        actions: [{ type: 'worker', value: [worker()] }],
      })
      return result.id
    },
    async remove(domain, id) {
      try {
        await request(`/zones/${await zone(domain)}/email/routing/rules/${id}`, 'DELETE')
        return true
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return false
        throw error
      }
    },
  }
}
