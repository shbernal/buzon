export type Call = { url: string; headers: Headers; method: string; body?: string }

/** A fetch stub that records every call and answers through `respond`. */
export function fake(respond: (call: Call) => Response) {
  const calls: Call[] = []
  const fetcher = (async (url: string, init: RequestInit) => {
    const call = {
      url,
      headers: new Headers(init.headers),
      method: init.method ?? 'GET',
      body: init.body as string | undefined,
    }
    calls.push(call)
    return respond(call)
  }) as unknown as typeof fetch
  return { calls, fetcher }
}

/** The rejection message of a promise that must fail. */
export async function failure(promise: Promise<unknown>): Promise<string> {
  return promise.then(
    () => 'resolved',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  )
}

export const json = (body: unknown, status = 200) => Response.json(body, { status })
export const secrets = (key: string) => (key === 'site-password' ? 'site' : 'admin')
export const config = { url: 'https://mail.example.com', domain: 'example.com' }
