import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { formatSources } from '../src/fmt.js'

const execFileAsync = promisify(execFile)
const cli = resolve(import.meta.dirname, '../dist/cli.js')

const MESSY = '# T\n\n| a | bbbb |\n| cc | d |\n'
const ALIGNED = '# T\n\n| a  | bbbb |\n| cc | d    |\n'

async function site(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'cp-fmt-'))
  await writeFile(resolve(root, 'carve-press.config.js'), "export default { title: 'T', srcDir: 'docs' }\n")
  await mkdir(resolve(root, 'docs/snippets'), { recursive: true })
  await mkdir(resolve(root, 'docs/.hidden'), { recursive: true })
  await writeFile(resolve(root, 'docs/index.crv'), '---\ntitle: Home\n---\n\n# Home\n')
  await writeFile(resolve(root, 'docs/tables.crv'), MESSY)
  await writeFile(resolve(root, 'docs/snippets/part.crv'), 'Part.\n')
  await writeFile(resolve(root, 'docs/.hidden/skip.crv'), '---\ntitle: X\n---\n')
  return root
}

describe('formatSources', () => {
  it('rewrites every .crv under srcDir to canonical form, snippets included', async () => {
    const root = await site()
    const result = await formatSources({ root })
    expect(result.files).toEqual(['docs/index.crv', 'docs/snippets/part.crv', 'docs/tables.crv'])
    expect(result.changed).toEqual(['docs/index.crv'])
    expect(await readFile(resolve(root, 'docs/index.crv'), 'utf8')).toBe(
      '---yaml\ntitle: Home\n---\n\n# Home\n',
    )
    expect(await readFile(resolve(root, 'docs/.hidden/skip.crv'), 'utf8')).toBe('---\ntitle: X\n---\n')
  })

  it('aligns table columns with alignTables and leaves them alone without it', async () => {
    const root = await site()
    await formatSources({ root, paths: ['docs/tables.crv'] })
    expect(await readFile(resolve(root, 'docs/tables.crv'), 'utf8')).toBe(MESSY)
    const aligned = await formatSources({ root, paths: ['docs/tables.crv'], alignTables: true })
    expect(aligned.changed).toEqual(['docs/tables.crv'])
    expect(await readFile(resolve(root, 'docs/tables.crv'), 'utf8')).toBe(ALIGNED)
  })

  it('reports without writing in check mode', async () => {
    const root = await site()
    const result = await formatSources({ root, check: true, alignTables: true })
    expect(result.changed).toEqual(['docs/index.crv', 'docs/tables.crv'])
    expect(await readFile(resolve(root, 'docs/tables.crv'), 'utf8')).toBe(MESSY)
  })

  it('fails on a path that does not exist', async () => {
    const root = await site()
    await expect(formatSources({ root, paths: ['docs/missing.crv'] })).rejects.toThrow(/no such file/)
  })
})

describe('carve-press fmt', () => {
  const run = (args: string[]) =>
    execFileAsync(process.execPath, [cli, ...args]).then(
      (out) => ({ code: 0, ...out }),
      (error: { code: number; stdout: string; stderr: string }) => error,
    )

  it('exits 1 under --check while a file needs formatting, and 0 once it does not', async () => {
    const root = await site()
    const before = await run(['fmt', '--check', '--align-tables', '--root', root])
    expect(before.code).toBe(1)
    expect(before.stdout).toContain('docs/tables.crv')
    expect(before.stderr).toMatch(/2 of 3 file\(s\) need formatting/)

    expect((await run(['fmt', '--align-tables', '--root', root])).code).toBe(0)
    expect((await run(['fmt', '--check', '--align-tables', '--root', root])).code).toBe(0)
  })
})
