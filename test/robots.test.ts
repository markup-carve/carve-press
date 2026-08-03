import { describe, it, expect } from 'vitest'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { buildSite } from '../src/build.js'

async function site(files: Record<string, string> = {}) {
  const root = await mkdtemp(resolve(tmpdir(), 'cp-robots-'))
  await mkdir(resolve(root, 'docs'), { recursive: true })
  await writeFile(resolve(root, 'docs/index.crv'), '---\ntitle: Home\n---\n# Home\n')
  for (const [name, source] of Object.entries(files)) {
    const path = resolve(root, name)
    await mkdir(resolve(path, '..'), { recursive: true })
    await writeFile(path, source)
  }
  return root
}

async function build(root: string, config: object = {}) {
  const outDir = await mkdtemp(resolve(tmpdir(), 'cp-robots-out-'))
  await buildSite({
    root,
    config: { title: 'Site', srcDir: 'docs', outDir, themeConfig: { sidebar: {} }, ...config },
  })
  return outDir
}

describe('robots.txt', () => {
  it('advertises the sitemap at an absolute URL under the site base', async () => {
    const outDir = await build(await site(), {
      hostname: 'https://example.github.io',
      base: '/project/',
    })

    const txt = await readFile(resolve(outDir, 'robots.txt'), 'utf8')

    expect(txt).toContain('User-agent: *')
    expect(txt).toContain('Sitemap: https://example.github.io/project/sitemap.xml')
  })

  it('omits the sitemap line when the site does not know its hostname', async () => {
    const txt = await readFile(resolve(await build(await site()), 'robots.txt'), 'utf8')

    // A relative Sitemap line is one crawlers ignore, so it is better absent.
    expect(txt).toContain('User-agent: *')
    expect(txt).not.toContain('Sitemap:')
  })

  it('never replaces a robots.txt the site ships itself', async () => {
    const own = 'User-agent: *\nDisallow: /internal/\n'
    const root = await site({ 'public/robots.txt': own })

    const outDir = await build(root, { hostname: 'https://example.com' })

    // A file in publicDir is the author's explicit answer; overwriting it would
    // only be discovered by a crawler doing the wrong thing weeks later.
    await expect(readFile(resolve(outDir, 'robots.txt'), 'utf8')).resolves.toBe(own)
  })

  it('writes nothing when robots is false', async () => {
    const outDir = await build(await site(), { robots: false, hostname: 'https://example.com' })

    await expect(readFile(resolve(outDir, 'robots.txt'), 'utf8')).rejects.toThrow()
  })

  it('honors a custom sitemap filename, and omitting the sitemap entirely', async () => {
    const root = await site()
    const custom = await build(root, {
      hostname: 'https://example.com',
      robots: { sitemap: 'map.xml' },
    })
    const none = await build(root, { hostname: 'https://example.com', robots: { sitemap: false } })

    await expect(readFile(resolve(custom, 'robots.txt'), 'utf8')).resolves.toContain(
      'Sitemap: https://example.com/map.xml',
    )
    await expect(readFile(resolve(none, 'robots.txt'), 'utf8')).resolves.not.toContain('Sitemap:')
  })
})
