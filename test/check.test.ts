import { execFile } from 'node:child_process'
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { checkSite } from '../src/check.js'

const execFileAsync = promisify(execFile)
const cli = resolve(import.meta.dirname, '../dist/cli.js')

const exists = (path: string) => access(path).then(() => true, () => false)

async function site(index: string): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'cp-check-'))
  await writeFile(resolve(root, 'carve-press.config.js'), "export default { title: 'T', srcDir: '.', outDir: 'dist' }\n")
  await writeFile(resolve(root, 'index.crv'), index)
  return root
}

describe('checkSite', () => {
  it('passes a clean site and writes neither the build nor the route manifest', async () => {
    const root = await site('# Home\n\nSee </#Home>.\n')
    const result = await checkSite({ root, config: { title: 'T', srcDir: '.', outDir: 'dist' } })
    expect(result.routes).toEqual(['/'])
    expect(await exists(resolve(root, 'dist'))).toBe(false)
    expect(await exists(resolve(root, 'routes.json'))).toBe(false)
  })

  it('fails on a lint finding', async () => {
    const root = await site('# Home\n\nSee </#missing>.\n')
    await expect(checkSite({ root, config: { title: 'T', srcDir: '.' } })).rejects.toThrow(/broken-crossref/)
  })

  it('fails on a dead internal link', async () => {
    const root = await site('# Home\n\n[gone](/nowhere)\n')
    await expect(checkSite({ root, config: { title: 'T', srcDir: '.' } })).rejects.toThrow(/dead internal link/)
  })
})

describe('carve-press check', () => {
  const run = (root: string) =>
    execFileAsync(process.execPath, [cli, 'check', '--root', root]).then(
      (out) => ({ code: 0, ...out }),
      (error: { code: number; stdout: string; stderr: string }) => error,
    )

  it('exits 0 on a clean site and non-zero on an error', async () => {
    const clean = await run(await site('# Home\n'))
    expect(clean.code).toBe(0)
    expect(clean.stdout).toMatch(/checked 1 page\(s\)/)

    const root = await site('# Home\n\nSee </#missing>.\n')
    const broken = await run(root)
    expect(broken.code).toBe(1)
    expect(broken.stderr).toMatch(/index\.crv:3:5 broken-crossref/)
    expect(await exists(resolve(root, 'dist'))).toBe(false)
    expect(await readFile(resolve(root, 'index.crv'), 'utf8')).toContain('</#missing>')
  })
})
