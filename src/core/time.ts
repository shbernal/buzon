import { UsageError } from './args.ts'

/** D1 stores `YYYY-MM-DD HH:MM:SS` in UTC. */
export function serverDate(raw: string): string | undefined {
  const date = new Date(`${raw.replace(' ', 'T')}Z`)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

const UNITS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }

/** `90`, `90s`, `5m`, `2h` or `1d`, in milliseconds. A bare number is seconds. */
export function parseDuration(raw: string, flag: string): number {
  const match = /^(\d+(?:\.\d+)?)([smhd]?)$/.exec(raw.trim())
  if (!match) throw new UsageError(`--${flag} must be a duration such as 90s, 5m or 2h`)
  return Number(match[1]) * UNITS[match[2] || 's']!
}
