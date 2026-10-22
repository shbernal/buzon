const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  zwnj: '',
  shy: '',
}

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (match, entity: string) => {
    const name = entity.toLowerCase()
    if (!name.startsWith('#')) return ENTITIES[name] ?? match
    const code = name.startsWith('#x') ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1))
    return Number.isFinite(code) && code >= 0 && code <= 0x10ffff
      ? String.fromCodePoint(code)
      : match
  })
}

const ANCHOR = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi
const HREF = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i

/** Readable text from an HTML part, with each link's target after its text. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<\s*(script|style|head|svg|title)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(ANCHOR, (_, attributes: string, inner: string) => {
        const href = anchorHref(attributes)
        const text = inner.replace(/<[^>]+>/g, ' ').trim()
        return href && href !== decodeEntities(text) ? ` ${text} (${href}) ` : ` ${text} `
      })
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<\/\s*(p|div|tr|li|table|section|article|header|footer|h[1-6])\s*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\r\f\v ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function anchorHref(attributes: string): string | undefined {
  const match = HREF.exec(attributes)
  const raw = match?.[1] ?? match?.[2] ?? match?.[3]
  return raw === undefined ? undefined : decodeEntities(raw.trim())
}

export type Link = { url: string; text: string }

export function htmlLinks(html: string): Link[] {
  const links: Link[] = []
  for (const [, attributes, inner] of html.matchAll(ANCHOR)) {
    const url = anchorHref(attributes!)
    if (url) links.push({ url, text: htmlToText(inner!) })
  }
  return links
}

/**
 * Bare URLs, without the punctuation that usually closes the sentence around them. The rest
 * of the URL's line is its text, or the line above when the URL stands alone.
 */
export function textLinks(text: string): Link[] {
  const links: Link[] = []
  const lines = text.split(/\r?\n/)
  lines.forEach((line, index) => {
    for (const [url] of line.matchAll(/https?:\/\/[^\s<>"'\]]+/gi)) {
      const label = line.replace(url, ' ').trim() || (lines[index - 1] ?? '').trim()
      links.push({ url: url.replace(/[.,;:!?)]+$/, ''), text: label })
    }
  })
  return links
}

const UNWANTED =
  /unsubscribe|opt[-_ ]?out|preferences|manage[-_ ]?(subscription|e?mail)|list-manage/i
const ASSET = /\.(png|jpe?g|gif|svg|webp|ico|css|js|woff2?|ttf)([?#]|$)/i
const TRACKING = /\/(open|pixel|beacon)(\.gif)?([/?#]|$)/i
const LINK_KEYWORDS =
  /verif|confirm|activat|token|magic|log-?in|sign-?in|sign-?up|auth|validat|reset/gi

const score = (link: Link) =>
  (link.text.match(LINK_KEYWORDS)?.length ?? 0) * 2 + (link.url.match(LINK_KEYWORDS)?.length ?? 0)

/**
 * The link that most looks like a verification link: HTML anchors first, else URLs in the text
 * part. Unsubscribe, tracking and asset links never count, and neither does a link with no
 * keyword in its text or URL, so a mail without one is no match.
 */
export function bestLink(mail: { html: string; text: string }): string | undefined {
  const fromHtml = mail.html ? htmlLinks(mail.html) : []
  const candidates = (fromHtml.length > 0 ? fromHtml : textLinks(mail.text)).filter(
    (link) =>
      /^https?:\/\//i.test(link.url) &&
      !UNWANTED.test(link.url) &&
      !UNWANTED.test(link.text) &&
      !ASSET.test(link.url) &&
      !TRACKING.test(link.url),
  )
  let best: { url: string; score: number } | undefined
  for (const link of candidates) {
    const value = score(link)
    if (value > 0 && (!best || value > best.score)) best = { url: link.url, score: value }
  }
  return best?.url
}

/** The instance's own extraction, saved in the row's `metadata` shortly after the mail lands. */
export function serverCode(metadata: unknown): string | undefined {
  if (typeof metadata !== 'string' || !metadata) return undefined
  try {
    const { ai_extract } = JSON.parse(metadata) as {
      ai_extract?: { type?: string; result?: string }
    }
    return ai_extract?.type === 'auth_code' && ai_extract.result ? ai_extract.result : undefined
  } catch {
    return undefined
  }
}

const CODE_KEYWORD =
  /(?<!(promo|coupon|discount|gift|referral|invite|zip|postal|country|area|error|status|tracking|order|reference|voucher)[\s-]?)\bcodes?\b|verification|\bverify\b|\botp\b|passcode|\bpin\b|one[\s-]?time|验证码|c[óo]digo|codice|код/giu
const DIGIT_CODE = /(?<![\w+\-/.,:$€£#])(\d{3}[ -]\d{3}|\d{4,8})(?![\w/%]|[.,:]\d)/g
const ALNUM_CODE =
  /(?<![\w\-+/#])((?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{6,8})(?![\w\-/])/g
/** How far from a keyword a code may sit, in characters. */
const NEAR = 120

function isDate(digits: string): boolean {
  const year = Number(digits.slice(0, 4))
  if (year < 1900 || year > 2099) return false
  if (digits.length === 4) return true
  const month = Number(digits.slice(4, 6))
  const day = Number(digits.slice(6, 8))
  return digits.length === 8 && month >= 1 && month <= 12 && day >= 1 && day <= 31
}

/**
 * A code near a verification keyword: 4 to 8 digits, or 6 to 8 letters and digits with at
 * least one of each. URLs and addresses are dropped first, since their digits are never codes.
 * The candidate closest to a keyword wins, digits on a tie.
 */
export function localCode(subject: string, body: string): string | undefined {
  const text = `${subject}\n\n${body}`
    .replace(/[​-‍⁠﻿­]/g, '')
    .replace(/\bhttps?:\/\/[^\s<>"']+/gi, ' ')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, ' ')
  const keywords = [...text.matchAll(CODE_KEYWORD)].map((match) => match.index)
  if (keywords.length === 0) return undefined

  let best: { code: string; distance: number } | undefined
  for (const [pattern, digits] of [
    [DIGIT_CODE, true],
    [ALNUM_CODE, false],
  ] as const) {
    for (const match of text.matchAll(pattern)) {
      const code = match[1]!.replace(/[ -]/g, '')
      if (digits && isDate(code)) continue
      const start = match.index
      const end = start + match[0].length
      const distance = Math.min(
        ...keywords.map((at) => (at < start ? start - at : Math.max(0, at - end))),
      )
      if (distance <= NEAR && (!best || distance < best.distance)) best = { code, distance }
    }
  }
  return best?.code
}
