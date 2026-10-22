import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** The parsed file, or `undefined` when it does not exist. A damaged file throws. */
export function readJson(file: string): unknown {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    throw new Error(`${file} is not valid JSON`, { cause: error })
  }
}

/**
 * Written beside the target and renamed over it, so no reader ever sees half a file. The
 * temp file gets its mode before any content, so a secret is never readable by others.
 */
export function writeAtomic(file: string, content: string, mode = 0o644): void {
  mkdirSync(dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  try {
    writeFileSync(temp, '', { mode })
    chmodSync(temp, mode)
    writeFileSync(temp, content)
    renameSync(temp, file)
  } catch (error) {
    rmSync(temp, { force: true })
    throw error
  }
}

export function writeJson(file: string, value: unknown, mode?: number): void {
  writeAtomic(file, `${JSON.stringify(value, null, 2)}\n`, mode)
}
