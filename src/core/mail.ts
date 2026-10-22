import type { Api } from './api.ts'
import { htmlToText } from './extract.ts'
import { serverDate } from './time.ts'

/** A row of `/api/parsed_mails`: the stored mail with its MIME parsed by the instance. */
export type ParsedMail = {
  id: number
  /** Envelope sender. `sender` is the `From` header. */
  source: string
  address: string
  created_at: string
  metadata: string | null
  sender: string
  subject: string
  text: string
  html: string
  attachments: { filename: string; mimeType: string; size: number }[]
}

export type Mail = {
  id: number
  from: string
  to: string
  subject: string
  date: string
  /** The text part, or the HTML part as text when there is none. */
  text: string
  html: string
  attachments: ParsedMail['attachments']
  metadata: string | null
}

export function toMail(row: ParsedMail): Mail {
  return {
    id: row.id,
    from: row.sender || row.source,
    to: row.address,
    subject: row.subject,
    date: serverDate(row.created_at) ?? row.created_at,
    text: row.text.trim() || htmlToText(row.html),
    html: row.html,
    attachments: row.attachments,
    metadata: row.metadata,
  }
}

/** The largest page the instance serves. */
const LIMIT = 100

/** Newest first. */
export async function listMails(api: Api, jwt: string, limit = LIMIT): Promise<Mail[]> {
  const out: Mail[] = []
  for (let offset = 0; ; offset += LIMIT) {
    const page = Math.min(LIMIT, limit - out.length)
    const { results } = await api.request<{ results: ParsedMail[] }>(
      `/api/parsed_mails?limit=${page}&offset=${offset}`,
      { jwt },
    )
    out.push(...results.map(toMail))
    if (results.length < page || out.length >= limit) return out
  }
}

export async function getMail(api: Api, jwt: string, id: number): Promise<Mail | undefined> {
  const row = await api.request<ParsedMail | null>(`/api/parsed_mail/${id}`, { jwt })
  return row ? toMail(row) : undefined
}

export async function getRawMail(api: Api, jwt: string, id: number): Promise<string | undefined> {
  const row = await api.request<{ raw?: string } | null>(`/api/mail/${id}`, { jwt })
  return row?.raw
}

export async function deleteMail(api: Api, jwt: string, id: number): Promise<boolean> {
  const { success } = await api.request<{ success: boolean }>(`/api/mails/${id}`, {
    method: 'DELETE',
    jwt,
  })
  return success
}
