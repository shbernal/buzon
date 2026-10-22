import { stringFlag, UsageError } from '../core/args.ts'
import { ApiError } from '../core/api.ts'
import { addressJwt } from '../core/credentials.ts'
import { bestLink, localCode, serverCode } from '../core/extract.ts'
import { deleteMail, getMail, getRawMail, listMails, type Mail } from '../core/mail.ts'
import { parseDuration } from '../core/time.ts'
import { type Context, type Input, resolveAddress } from './context.ts'

export type MailView = Omit<Mail, 'metadata'>

function view(mail: Mail): MailView {
  const { metadata: _, ...rest } = mail
  return rest
}

function mailId(raw: string | undefined, usage: string): number {
  const id = Number(raw)
  if (!raw || !Number.isSafeInteger(id) || id <= 0) throw new UsageError(usage)
  return id
}

export function mailText(mail: MailView): string {
  const lines = [
    `id       ${mail.id}`,
    `from     ${mail.from}`,
    `subject  ${mail.subject}`,
    `date     ${mail.date}`,
  ]
  if (mail.attachments.length > 0) {
    lines.push(`files    ${mail.attachments.map((file) => file.filename).join(', ')}`)
  }
  return `${lines.join('\n')}\n\n${mail.text}`
}

const READ_USAGE = 'usage: buzon read <address> [--latest | --id <n> | --all] [--raw]'

export type ReadResult = { mails: MailView[] } | { raw: string }

export async function read(
  { positionals, flags }: Input,
  { config, api }: Context,
): Promise<ReadResult> {
  const address = resolveAddress(positionals[0], config, READ_USAGE)
  const idFlag = stringFlag(flags, 'id')
  const all = flags.all === true
  if ([idFlag !== undefined, all, flags.latest === true].filter(Boolean).length > 1) {
    throw new UsageError(READ_USAGE)
  }
  if (all && flags.raw === true) throw new UsageError('--raw reads one mail, not --all')
  const jwt = addressJwt(address)

  let mails: Mail[]
  if (idFlag !== undefined) {
    const mail = await getMail(api, jwt, mailId(idFlag, READ_USAGE))
    if (!mail) throw new Error(`no mail ${idFlag} for ${address}`)
    mails = [mail]
  } else {
    mails = await listMails(api, jwt, all ? Number.POSITIVE_INFINITY : 1)
    if (!all && mails.length === 0) throw new Error(`no mail for ${address}`)
  }

  if (flags.raw === true) {
    const raw = await getRawMail(api, jwt, mails[0]!.id)
    if (raw === undefined) throw new Error(`no raw message for mail ${mails[0]!.id}`)
    return { raw }
  }
  return { mails: mails.map(view) }
}

export function readText(result: ReadResult): string {
  if ('raw' in result) return result.raw
  return result.mails.map(mailText).join('\n\n----\n\n') || 'no mail'
}

export type Clock = { now(): number; sleep(ms: number): Promise<void> }

const realClock: Clock = { now: () => Date.now(), sleep: (ms) => Bun.sleep(ms) }

/** Upstream's polling etiquette: start at 3 s, back off to 10 s. */
const FIRST_POLL = 3000
const LAST_POLL = 10_000
const BACKOFF = 1.5
/** Mails looked at per poll, newest first. */
const WINDOW = 20

const WAIT_USAGE =
  'usage: buzon wait <address> [--code | --link] [--from <regex>] [--subject <regex>] [--timeout 300] [--since now|<duration>|<date>]'

export class WaitTimeout extends Error {}

export type WaitResult = { id: number; code: string } | { id: number; link: string } | MailView

function regexFlag(flags: Input['flags'], name: string): RegExp | undefined {
  const raw = stringFlag(flags, name)
  if (raw === undefined) return undefined
  try {
    return new RegExp(raw, 'i')
  } catch (error) {
    throw new UsageError(`--${name} is not a valid regular expression: ${(error as Error).message}`)
  }
}

/** `now` waits for mail after the first poll, by id, so a skewed local clock cannot matter. */
function sinceFlag(raw: string | undefined, now: number): number | 'now' {
  if (raw === undefined || raw === 'now') return 'now'
  if (/^\d+(\.\d+)?[smhd]?$/.test(raw)) return now - parseDuration(raw, 'since')
  const date = Date.parse(raw)
  if (Number.isNaN(date))
    throw new UsageError('--since takes now, a duration such as 10m, or a date')
  return date
}

/**
 * Polls until a new mail passes the filters and yields what was asked for. A mail that
 * passes the filters but has no code yet is looked at again on the next poll, since the
 * instance saves its own code extraction just after the mail lands.
 */
export async function wait(
  { positionals, flags }: Input,
  { config, api }: Context,
  clock: Clock = realClock,
): Promise<WaitResult> {
  const address = resolveAddress(positionals[0], config, WAIT_USAGE)
  const code = flags.code === true
  const link = flags.link === true
  if (code && link) throw new UsageError('--code and --link are exclusive')
  const from = regexFlag(flags, 'from')
  const subject = regexFlag(flags, 'subject')
  const timeoutFlag = stringFlag(flags, 'timeout')
  const timeout = timeoutFlag === undefined ? 300_000 : parseDuration(timeoutFlag, 'timeout')
  const since = sinceFlag(stringFlag(flags, 'since'), clock.now())
  const jwt = addressJwt(address)

  const deadline = clock.now() + timeout
  /** Whole seconds, the resolution of the instance's timestamps. */
  const cutoff = since === 'now' ? undefined : Math.floor(since / 1000) * 1000
  let baseline: number | undefined
  let interval = FIRST_POLL

  const match = (mail: Mail): WaitResult | undefined => {
    const fresh = cutoff === undefined ? mail.id > baseline! : Date.parse(mail.date) >= cutoff
    if (!fresh) return undefined
    if (from && !from.test(mail.from)) return undefined
    if (subject && !subject.test(mail.subject)) return undefined
    if (code) {
      const found = serverCode(mail.metadata) ?? localCode(mail.subject, mail.text)
      return found ? { id: mail.id, code: found } : undefined
    }
    if (link) {
      const found = bestLink(mail)
      return found ? { id: mail.id, link: found } : undefined
    }
    return view(mail)
  }

  for (;;) {
    let pause = interval
    try {
      const mails = await listMails(api, jwt, WINDOW)
      if (cutoff === undefined && baseline === undefined) {
        baseline = Math.max(0, ...mails.map((mail) => mail.id))
      } else {
        for (const mail of mails) {
          const result = match(mail)
          if (result) return result
        }
      }
      interval = Math.min(interval * BACKOFF, LAST_POLL)
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 429)) throw error
      pause = Math.max(pause, (error.retryAfter ?? 0) * 1000)
    }
    const remaining = deadline - clock.now()
    if (remaining <= 0) {
      throw new WaitTimeout(`no matching mail for ${address} within ${timeout / 1000}s`)
    }
    await clock.sleep(Math.min(pause, remaining))
  }
}

export function waitText(result: WaitResult): string {
  if ('code' in result) return result.code
  if ('link' in result) return result.link
  return mailText(result)
}

const DELETE_MAIL_USAGE = 'usage: buzon delete-mail <address> <id>'

/** The instance answers success for an id it does not hold, so the mail is looked up first. */
export async function removeMail(
  { positionals }: Input,
  { config, api }: Context,
): Promise<{ address: string; id: number }> {
  const address = resolveAddress(positionals[0], config, DELETE_MAIL_USAGE)
  const id = mailId(positionals[1], DELETE_MAIL_USAGE)
  const jwt = addressJwt(address)
  if (!(await getMail(api, jwt, id))) throw new Error(`no mail ${id} for ${address}`)
  if (!(await deleteMail(api, jwt, id))) throw new Error(`the instance did not delete mail ${id}`)
  return { address, id }
}

export const removeMailText = (result: { address: string; id: number }) =>
  `deleted mail ${result.id} of ${result.address}`
