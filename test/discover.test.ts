import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { discoverPages } from '../src/content/discover.js'

const SITE = resolve(import.meta.dirname, 'fixtures/site')

describe('discoverPages', () => {
  it('finds every .crv page and assigns routes', async () => {
    const pages = await discoverPages(SITE, [])
    expect(pages.map((p) => p.route).sort()).toEqual([
      '/',
      '/draft',
      '/guide/',
      '/guide/deep',
      '/start',
    ])
  })

  it('returns pages in a deterministic order', async () => {
    const a = await discoverPages(SITE, [])
    const b = await discoverPages(SITE, [])
    expect(a.map((p) => p.relPath)).toEqual(b.map((p) => p.relPath))
  })

  it('parses frontmatter and keeps the body separate', async () => {
    const pages = await discoverPages(SITE, [])
    const start = pages.find((p) => p.route === '/start')!
    expect(start.frontmatter.title).toBe('Start')
    expect(start.source.startsWith('\n# Start')).toBe(true)
    expect(start.bodyStartLine).toBe(4)
  })

  it('honors srcExclude globs', async () => {
    const pages = await discoverPages(SITE, ['draft.crv'])
    expect(pages.map((p) => p.route)).not.toContain('/draft')
  })

  it('excludes a whole subtree with a ** glob', async () => {
    const pages = await discoverPages(SITE, ['guide/**'])
    // Pages are sorted by relPath, not route: draft.crv < index.crv < start.crv.
    expect(pages.map((p) => p.route)).toEqual(['/draft', '/', '/start'])
  })

  it('throws on a duplicate route', async () => {
    // `foo.crv` and `foo/index.crv` produce different routes (`/foo`, `/foo/`)
    // but the same output file under cleanUrls, so this MUST be caught here -
    // otherwise the second page silently overwrites the first at write time.
    // Written into a temp dir so the shared fixture stays clean.
    const { mkdtemp, writeFile, mkdir } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const dir = await mkdtemp(resolve(tmpdir(), 'cp-'))
    await writeFile(resolve(dir, 'foo.crv'), '---\ntitle: A\n---\n')
    await mkdir(resolve(dir, 'foo'))
    await writeFile(resolve(dir, 'foo/index.crv'), '---\ntitle: B\n---\n')
    await expect(discoverPages(dir, [])).rejects.toThrow(/duplicate route/)
  })
})
