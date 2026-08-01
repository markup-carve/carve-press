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

  it('returns pages sorted by relPath, not by readdir order', async () => {
    // Pinning the exact order matters: calling discoverPages twice and comparing
    // the two results would pass even with the sort deleted, because readdir
    // returns the same order twice on an unchanged directory. Only an absolute
    // expectation can fail when the sort goes away.
    const pages = await discoverPages(SITE, [])
    expect(pages.map((p) => p.relPath)).toEqual([
      'draft.crv',
      'guide/deep.crv',
      'guide/index.crv',
      'index.crv',
      'start.crv',
    ])
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

  it('reports an unreadable directory as a BuildError, not a raw stack trace', async () => {
    const { mkdtemp, mkdir, chmod, writeFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const dir = await mkdtemp(resolve(tmpdir(), 'cp-perm-'))
    await writeFile(resolve(dir, 'ok.crv'), '---\ntitle: A\n---\n')
    const locked = resolve(dir, 'locked')
    await mkdir(locked)
    await chmod(locked, 0o000)
    try {
      await expect(discoverPages(dir, [])).rejects.toThrow(/cannot read content directory/)
    } finally {
      // Restore the mode so the temp dir can be cleaned up by the OS.
      await chmod(locked, 0o755)
    }
  })
})
