import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApi } from '../src/core/api.ts'
import { writeCredentials } from '../src/core/credentials.ts'
import { bestLink, htmlToText, localCode, serverCode } from '../src/core/extract.ts'
import type { ParsedMail } from '../src/core/mail.ts'
import { read, removeMail, wait, WaitTimeout, type Clock } from '../src/commands/mail.ts'
import { config, failure, fake, json, secrets } from './fake.ts'

const ADDRESS = 'ste-2610-abc@example.com'

let nextId = 1
function mail(fields: Partial<ParsedMail>): ParsedMail {
  return {
    id: nextId++,
    source: 'bounce@service.example.com',
    address: ADDRESS,
    created_at: '2026-10-22 10:00:00',
    metadata: null,
    sender: 'Service <no-reply@service.example.com>',
    subject: '',
    text: '',
    html: '',
    attachments: [],
    ...fields,
  }
}

const fixtures = {
  codeInSubject: () => mail({ subject: '482913 is your Acme verification code', text: 'Welcome!' }),
  codeInBody: () =>
    mail({
      subject: 'Confirm your account',
      text: 'Order 2026-118 is waiting.\n\nYour verification code is: 591-204\nIt expires in 10 minutes.',
    }),
  htmlOnlyLink: () =>
    mail({
      subject: 'Activate your account',
      html: `<html><body>
        <a href="https://service.example.com/"><img src="https://cdn.example.com/logo.png"></a>
        <p>Thanks for signing up.</p>
        <a href="https://service.example.com/activate?token=a1b2&amp;u=7">Activate account</a>
        <img src="https://service.example.com/open/pixel.gif" width="1">
      </body></html>`,
    }),
  multipartLink: () =>
    mail({
      subject: 'Please verify your email',
      text: 'Verify: https://service.example.com/v/abc\nUnsubscribe: https://service.example.com/unsubscribe?u=7',
      html: `<p><a href="https://service.example.com/unsubscribe?u=7">Unsubscribe from these emails</a></p>
        <p><a href="https://service.example.com/help">Help center</a></p>
        <p><a href="https://service.example.com/v/abc">Verify email address</a></p>`,
    }),
}

describe('extract', () => {
  test('a code in the subject', () => {
    const m = fixtures.codeInSubject()
    expect(localCode(m.subject, m.text)).toBe('482913')
  })

  test('a grouped code in the body, not the year or order number', () => {
    const m = fixtures.codeInBody()
    expect(localCode(m.subject, m.text)).toBe('591204')
  })

  test('an alphanumeric code, and nothing without a keyword', () => {
    expect(localCode('', 'Your login code: K7X9Q2')).toBe('K7X9Q2')
    expect(localCode('Invoice 4471', 'Total 1234 EUR')).toBeUndefined()
    expect(localCode('', 'Use promo code SAVE2026 today')).toBeUndefined()
  })

  test('the server extraction, when it found a code', () => {
    expect(serverCode('{"ai_extract":{"type":"auth_code","result":"7788"}}')).toBe('7788')
    expect(serverCode('{"ai_extract":{"type":"none","result":""}}')).toBeUndefined()
    expect(serverCode(null)).toBeUndefined()
  })

  test('the activation link of an HTML-only mail, entities decoded', () => {
    expect(bestLink(fixtures.htmlOnlyLink())).toBe(
      'https://service.example.com/activate?token=a1b2&u=7',
    )
  })

  test('the verification link over unsubscribe and help links', () => {
    const m = fixtures.multipartLink()
    expect(bestLink(m)).toBe('https://service.example.com/v/abc')
    expect(bestLink({ html: '', text: m.text })).toBe('https://service.example.com/v/abc')
    expect(bestLink({ html: '<a href="https://example.com/">Home</a>', text: '' })).toBeUndefined()
  })

  test('HTML becomes readable text with link targets', () => {
    const text = htmlToText(fixtures.htmlOnlyLink().html)
    expect(text).toContain('Thanks for signing up.')
    expect(text).toContain('Activate account (https://service.example.com/activate?token=a1b2&u=7)')
    expect(text).not.toContain('<')
  })
})

/** An inbox whose content can change between polls, and a clock that only moves on sleep. */
function inbox(initial: ParsedMail[] = []) {
  let rows = initial
  let rateLimited = 0
  const { calls, fetcher } = fake((call) => {
    const url = new URL(call.url)
    if (rateLimited-- > 0) {
      return new Response('slow down', { status: 429, headers: { 'retry-after': '20' } })
    }
    if (url.pathname === '/api/parsed_mails') {
      const limit = Number(url.searchParams.get('limit'))
      const offset = Number(url.searchParams.get('offset'))
      const sorted = rows.toSorted((a, b) => b.id - a.id)
      return json({ results: sorted.slice(offset, offset + limit), count: rows.length })
    }
    const parsed = /^\/api\/parsed_mail\/(\d+)$/.exec(url.pathname)
    if (parsed) return json(rows.find((row) => row.id === Number(parsed[1])) ?? null)
    const raw = /^\/api\/mail\/(\d+)$/.exec(url.pathname)
    if (raw) return json({ id: Number(raw[1]), raw: 'From: a\r\n\r\nbody' })
    if (call.method === 'DELETE') return json({ success: true })
    return new Response('not found', { status: 404 })
  })
  const sleeps: number[] = []
  let now = Date.parse('2026-10-22T10:00:30Z')
  const clock: Clock = {
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms)
      now += ms
      onSleep?.(sleeps.length)
    },
  }
  let onSleep: ((count: number) => void) | undefined
  return {
    calls,
    sleeps,
    clock,
    context: { config, api: createApi(config, secrets, fetcher) },
    set: (next: ParsedMail[]) => (rows = next),
    rateLimit: (times: number) => (rateLimited = times),
    afterSleep: (hook: (count: number) => void) => (onSleep = hook),
  }
}

const input = (positionals: string[], flags: Record<string, string | boolean> = {}) => ({
  positionals,
  flags,
})

const saved = process.env.XDG_STATE_HOME

beforeEach(() => {
  process.env.XDG_STATE_HOME = mkdtempSync(join(tmpdir(), 'buzon-mail-'))
  writeCredentials({ [ADDRESS]: 'jwt' })
})

afterEach(() => {
  if (saved === undefined) delete process.env.XDG_STATE_HOME
  else process.env.XDG_STATE_HOME = saved
})

describe('wait', () => {
  test('ignores mail from before it started, then returns the code of a new one', async () => {
    const old = fixtures.codeInSubject()
    const box = inbox([old])
    box.afterSleep((count) => {
      if (count === 2) box.set([old, fixtures.codeInBody()])
    })
    expect(await wait(input([ADDRESS], { code: true }), box.context, box.clock)).toEqual({
      id: old.id + 1,
      code: '591204',
    })
    expect(box.sleeps).toEqual([3000, 4500])
  })

  test('prefers the server code, and filters by sender and subject', async () => {
    const other = mail({ subject: 'Your code: 1111', sender: 'Other <a@other.example.org>' })
    const ours = mail({
      subject: 'Your code',
      text: 'code 2222',
      metadata: '{"ai_extract":{"type":"auth_code","result":"3333"}}',
    })
    const box = inbox([other, ours])
    const flags = { code: true, since: '5m', from: 'service\\.example', subject: '^your code$' }
    expect(await wait(input([ADDRESS], flags), box.context, box.clock)).toEqual({
      id: ours.id,
      code: '3333',
    })
  })

  test('--link returns the best link of a new mail', async () => {
    const box = inbox([fixtures.multipartLink()])
    expect(
      await wait(input([ADDRESS], { link: true, since: '1h' }), box.context, box.clock),
    ).toEqual(expect.objectContaining({ link: 'https://service.example.com/v/abc' }))
  })

  test('--since skips mail older than the cutoff', async () => {
    const box = inbox([fixtures.codeInSubject()])
    const flags = { code: true, since: '2026-10-22T10:00:01Z', timeout: '5s' }
    expect(await failure(wait(input([ADDRESS], flags), box.context, box.clock))).toContain(
      'no matching mail',
    )
  })

  test('times out with backoff capped at 10 s, never sleeping past the deadline', async () => {
    const box = inbox()
    const result = await wait(input([ADDRESS], { timeout: '40' }), box.context, box.clock).catch(
      (error: unknown) => error,
    )
    expect(result).toBeInstanceOf(WaitTimeout)
    expect(box.sleeps).toEqual([3000, 4500, 6750, 10000, 10000, 5750])
  })

  test('honors Retry-After on 429', async () => {
    const box = inbox()
    box.rateLimit(1)
    await wait(input([ADDRESS], { timeout: '30s' }), box.context, box.clock).catch(() => {})
    expect(box.sleeps[0]).toBe(20000)
  })

  test('--code and --link together is a usage error', async () => {
    const box = inbox()
    expect(
      await failure(wait(input([ADDRESS], { code: true, link: true }), box.context, box.clock)),
    ).toContain('exclusive')
  })
})

describe('read and delete-mail', () => {
  test('latest by default, HTML as text when there is no text part', async () => {
    const first = fixtures.codeInSubject()
    const html = fixtures.htmlOnlyLink()
    const box = inbox([first, html])
    const result = await read(input([ADDRESS]), box.context)
    expect('mails' in result && result.mails.map((m) => m.id)).toEqual([html.id])
    expect('mails' in result && result.mails[0]!.text).toContain('Activate account')
    const all = await read(input([ADDRESS], { all: true }), box.context)
    expect('mails' in all && all.mails).toHaveLength(2)
    expect(await read(input([ADDRESS], { raw: true }), box.context)).toEqual({
      raw: 'From: a\r\n\r\nbody',
    })
  })

  test('an unknown id is an error, not a silent success', async () => {
    const box = inbox([fixtures.codeInSubject()])
    expect(await failure(removeMail(input([ADDRESS, '999']), box.context))).toContain('no mail 999')
    expect(box.calls.some((call) => call.method === 'DELETE')).toBe(false)
  })
})
