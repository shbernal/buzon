import { createInterface } from 'node:readline/promises'

export type Ask = (question: string, fallback?: string) => Promise<string>

/** One interface for every question: a second one would lose input the first had buffered. */
export async function withPrompt<T>(use: (ask: Ask) => Promise<T>): Promise<T> {
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  try {
    return await use(async (question, fallback) => {
      const hint = fallback ? ` [${fallback}]` : ''
      return (await rl.question(`${question}${hint}: `)).trim() || fallback || ''
    })
  } finally {
    rl.close()
  }
}
