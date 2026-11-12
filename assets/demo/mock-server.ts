/**
 * A stand-in for a cloudflare_temp_email instance, with just the routes the demo calls:
 * `POST /api/new_address`, `GET /api/parsed_mails`, `DELETE /api/delete_address`, and
 * `GET /admin/address` for the delete fallback. It serves example.com only.
 *
 * The random part of a new name is pinned to `9qa`, so the tape can type the address.
 * A verification mail lands shortly after the address is first polled for mail: `wait`
 * takes its first poll as the baseline, so a mail that came before it would never match.
 */

const PORT = Number(process.env.PORT ?? 8788)
const SITE_PASSWORD = process.env.BUZON_SITE_PASSWORD ?? 'demo'
const DOMAIN = 'example.com'
const DELIVERY_DELAY_MS = Number(process.env.DELIVERY_DELAY_MS ?? 1500)

type Address = { id: number; name: string; created_at: string; polled: boolean }
type Row = {
  id: number
  source: string
  address: string
  created_at: string
  metadata: string | null
  sender: string
  subject: string
  text: string
  html: string
  attachments: never[]
}

const addresses = new Map<string, Address>()
const mails: Row[] = []
let nextAddressId = 41
let nextMailId = 1207

/** D1's `YYYY-MM-DD HH:MM:SS`, in UTC. */
const d1Now = () => new Date().toISOString().slice(0, 19).replace('T', ' ')

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const text = (body: string, status: number) => new Response(body, { status })

/** The JWT is just the address, base64url: nothing here needs it to be signed. */
const jwtFor = (address: string) => `demo.${Buffer.from(address).toString('base64url')}.sig`
function addressOf(request: Request): Address | undefined {
  const token = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? ''
  const payload = token.split('.')[1]
  if (!payload) return undefined
  return addresses.get(Buffer.from(payload, 'base64url').toString())
}

function deliver(to: string) {
  const code = '482913'
  mails.push({
    id: nextMailId++,
    source: 'bounce@mail.acme.example.com',
    address: to,
    created_at: d1Now(),
    metadata: null,
    sender: 'Acme <no-reply@acme.example.com>',
    subject: 'Your Acme verification code',
    text: `Hi,\n\nYour verification code is ${code}. It expires in 10 minutes.\n\nThe Acme team`,
    html: '',
    attachments: [],
  })
}

Bun.serve({
  port: PORT,
  hostname: '127.0.0.1',
  async fetch(request) {
    const url = new URL(request.url)
    const path = url.pathname
    if (request.headers.get('x-custom-auth') !== SITE_PASSWORD) {
      return json({ code: 'CustomAuth', message: 'wrong site password' }, 401)
    }

    if (path === '/api/new_address' && request.method === 'POST') {
      const { name, domain } = (await request.json()) as { name: string; domain: string }
      if (domain !== DOMAIN) return text(`Invalid domain: ${domain}`, 400)
      const pinned = name.replace(/-[a-z0-9]{3}$/, '-9qa')
      const address = `${pinned}@${DOMAIN}`
      if (addresses.has(address)) return text('Address already exists', 400)
      const row = { id: nextAddressId++, name: address, created_at: d1Now(), polled: false }
      addresses.set(address, row)
      return json({ jwt: jwtFor(address), address, address_id: row.id })
    }

    if (path === '/api/parsed_mails' && request.method === 'GET') {
      const address = addressOf(request)
      if (!address) return text('Unauthorized', 401)
      if (!address.polled) {
        address.polled = true
        setTimeout(() => deliver(address.name), DELIVERY_DELAY_MS)
      }
      const limit = Number(url.searchParams.get('limit') ?? 20)
      const offset = Number(url.searchParams.get('offset') ?? 0)
      const results = mails
        .filter((mail) => mail.address === address.name)
        .toSorted((a, b) => b.id - a.id)
        .slice(offset, offset + limit)
      return json({ results })
    }

    if (path === '/api/delete_address' && request.method === 'DELETE') {
      const address = addressOf(request)
      if (!address) return text('Unauthorized', 401)
      addresses.delete(address.name)
      return json({ success: true })
    }

    if (path === '/admin/address' && request.method === 'GET') {
      const query = url.searchParams.get('query') ?? ''
      const results = [...addresses.values()]
        .filter((row) => row.name.includes(query))
        .map(({ id, name, created_at }) => ({ id, name, created_at }))
      return json({ results })
    }

    return text('Not Found', 404)
  },
})

console.log(`mock instance on http://127.0.0.1:${PORT}`)
