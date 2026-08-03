import { describe, it, expect } from 'vitest'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { buildSite } from '../../src/build.js'
import { createDevRebuilder } from '../../src/dev.js'

const PAGES = 300

const body = [
  'Paragraph with `inline code` and a [link](/guide/page-1).',
  '',
  '``` ts "example.ts"',
  'export const value = 1',
  '```',
  '',
  '- one',
  '- two',
].join('\n')

async function scaleSite(incremental: boolean): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'cp-scale-'))
  await mkdir(resolve(root, 'docs/guide'), { recursive: true })
  await writeFile(resolve(root, 'docs/index.crv'), '---\ntitle: Home\n---\n# Home\n')
  for (let i = 1; i <= PAGES; i += 1) {
    await writeFile(resolve(root, `docs/guide/page-${i}.crv`), `---\ntitle: Page ${i}\n---\n\n# Page ${i}\n\n${body}\n`)
  }
  await writeFile(
    resolve(root, 'carve-press.config.js'),
    `export default { title: 'Scale', srcDir: 'docs', outDir: '.site', ignoreDeadLinks: true${
      incremental ? ', dev: { incremental: true }' : ''
    } }\n`,
  )
  return root
}

/**
 * The fixture that justified incremental rebuilds, kept so the claim stays
 * measured rather than asserted. It counts work, not milliseconds: a wall-clock
 * threshold is a test that fails on a loaded CI runner and passes on a fast one,
 * which measures the machine rather than the code.
 */
describe('build at scale', () => {
  it('renders every page on a full build', async () => {
    const root = await scaleSite(false)

    const result = await buildSite({ root, config: (await import(`${root}/carve-press.config.js`)).default })

    expect(result.routes).toHaveLength(PAGES + 1)
    expect(result.renderStats.rendered).toBe(PAGES + 1)
    expect(result.renderStats.reused).toBe(0)
  }, 120_000)

  it('re-renders only what changed on an incremental dev rebuild', async () => {
    const root = await scaleSite(true)
    const rebuilder = createDevRebuilder(root)

    const first = await rebuilder.rebuild()
    expect(first.ok).toBe(true)

    await writeFile(resolve(root, 'docs/guide/page-7.crv'), `---\ntitle: Page 7\n---\n\n# Page 7\n\nEdited.\n`)
    const second = await rebuilder.rebuild()

    expect(second.ok).toBe(true)
    expect(second.renderStats?.rendered).toBe(1)
    expect(second.renderStats?.reused).toBe(PAGES)
  }, 120_000)
})
