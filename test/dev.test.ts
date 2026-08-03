import { describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { createDevRebuilder } from '../src/dev.js'

describe('createDevRebuilder', () => {
  it('returns failed rebuilds without throwing and recovers on the next success', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'cp-dev-'))
    await mkdir(resolve(root, 'docs'))
    await writeFile(resolve(root, 'carve-press.config.js'), "export default { title: 'Docs' }\n")
    await writeFile(resolve(root, 'docs/index.crv'), ['---', 'title: Home', '---', '', '# Home'].join('\n'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const success = vi.fn()
    const rebuilder = createDevRebuilder(root, success)

    await expect(rebuilder.rebuild()).resolves.toMatchObject({ ok: true })
    await expect(readFile(resolve(root, 'dist/index.html'), 'utf8')).resolves.toContain('<h1>Home')

    await writeFile(
      resolve(root, 'docs/index.crv'),
      ['---', 'title: Home', '---', '', '# Home', '', '[Missing](/missing)'].join('\n'),
    )
    await expect(rebuilder.rebuild()).resolves.toMatchObject({ ok: false })
    expect(error).toHaveBeenCalledWith(expect.stringContaining('/missing'))

    await writeFile(resolve(root, 'docs/start.crv'), ['---', 'title: Start', '---', '', '# Start'].join('\n'))
    await writeFile(
      resolve(root, 'docs/index.crv'),
      ['---', 'title: Home', '---', '', '# Home', '', '[Start](/start)'].join('\n'),
    )
    await expect(rebuilder.rebuild()).resolves.toMatchObject({ ok: true })
    await expect(readFile(resolve(root, 'dist/start/index.html'), 'utf8')).resolves.toContain('<h1>Start')
    expect(success).toHaveBeenCalledTimes(2)
    error.mockRestore()
  })
})
