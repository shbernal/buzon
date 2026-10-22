import type { Api } from './api.ts'

/** A row of `GET /admin/address`. `name` is the full address. */
export type ServerAddress = { id: number; name: string; created_at: string }

type Page = { results: ServerAddress[] }

/** The largest page the instance serves. */
const LIMIT = 100

async function pages(api: Api, query?: string): Promise<ServerAddress[]> {
  const out: ServerAddress[] = []
  for (let offset = 0; ; offset += LIMIT) {
    const params = new URLSearchParams({ limit: String(LIMIT), offset: String(offset) })
    if (query) params.set('query', query)
    const { results } = await api.request<Page>(`/admin/address?${params.toString()}`)
    out.push(...results)
    if (results.length < LIMIT) return out
  }
}

export function listServerAddresses(api: Api): Promise<ServerAddress[]> {
  return pages(api)
}

/** The search is a substring match, so the exact name is picked out of it. */
export async function findServerAddress(
  api: Api,
  address: string,
): Promise<ServerAddress | undefined> {
  return (await pages(api, address)).find((row) => row.name === address)
}

/** A fresh address JWT, signed by the instance for any address id. */
export async function mintJwt(api: Api, id: number): Promise<string> {
  const { jwt } = await api.request<{ jwt: string }>(`/admin/show_password/${id}`)
  return jwt
}

/** D1 stores `YYYY-MM-DD HH:MM:SS` in UTC. */
export function serverDate(raw: string): string | undefined {
  const date = new Date(`${raw.replace(' ', 'T')}Z`)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}
