import { expect, test } from 'bun:test'
import pkg from '../package.json'

test('--version prints the version', async () => {
  const proc = Bun.spawn(['bun', 'bin/buzon', '--version'], { cwd: `${import.meta.dir}/..` })
  expect((await new Response(proc.stdout).text()).trim()).toBe(pkg.version)
})
