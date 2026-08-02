import { describe, it, expect } from 'vitest'
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { buildSite } from '../src/build.js'
import { SourceError } from '../src/errors.js'

async function site(files: Record<string, string>) {
  const root = await mkdtemp(resolve(tmpdir(), 'cp-p2-'))
  const srcDir = resolve(root, 'docs')
  await mkdir(srcDir, { recursive: true })
  for (const [name, source] of Object.entries(files)) {
    const path = resolve(srcDir, name)
    await mkdir(resolve(path, '..'), { recursive: true })
    await writeFile(path, source)
  }
  return { root, srcDir }
}

async function build(root: string, config: object = {}) {
  const outDir = await mkdtemp(resolve(tmpdir(), 'cp-p2-out-'))
  await buildSite({ root, config: { title: 'Site', srcDir: 'docs', outDir, themeConfig: { sidebar: {} }, ...config } })
  return outDir
}

describe('P2 site features', () => {
  it('injects blog index, pagination, tag pages, and excludes drafts from derived files', async () => {
    const { root } = await site({
      'index.crv': '---\ntitle: Home\n---\n# Home\n',
      'blog/a.crv': '---\ntitle: A\ndate: 2026-01-01\ntags: [News]\n---\n# A\n\nAlpha body.\n',
      'blog/b.crv': '---\ntitle: B\ndate: 2026-02-01\ntags: [News]\n---\n# B\n\nBeta body.\n',
      'blog/draft.crv': '---\ntitle: Draft\ndate: 2026-03-01\ndraft: true\n---\n# Draft\n',
    })
    const outDir = await build(root, {
      hostname: 'https://example.com',
      blog: { dir: 'blog', route: '/blog/', perPage: 1 },
      feed: {},
    })

    await expect(readFile(resolve(outDir, 'blog/index.html'), 'utf8')).resolves.toContain('B')
    await expect(readFile(resolve(outDir, 'blog/page/2/index.html'), 'utf8')).resolves.toContain('A')
    await expect(readFile(resolve(outDir, 'blog/tags/news/index.html'), 'utf8')).resolves.toContain('B')
    await expect(readFile(resolve(outDir, 'blog/draft/index.html'), 'utf8')).resolves.toContain('Draft')
    const search = await readFile(resolve(outDir, 'assets/search-index.json'), 'utf8')
    const sitemap = await readFile(resolve(outDir, 'sitemap.xml'), 'utf8').catch(() => '')
    const feed = await readFile(resolve(outDir, 'feed.xml'), 'utf8')
    expect(search).not.toContain('/blog/draft')
    expect(sitemap).not.toContain('/blog/draft')
    expect(feed).not.toContain('Draft')
  })

  it('fails blog posts with invalid date or tags as SourceError', async () => {
    const { root } = await site({
      'blog/a.crv': '---\ntitle: A\ndate: nope\ntags: tag\n---\n# A\n',
    })
    await expect(build(root, { blog: { dir: 'blog' } })).rejects.toMatchObject({
      name: 'SourceError',
      srcPath: 'blog/a.crv',
      message: 'frontmatter: invalid date',
    } satisfies Partial<SourceError>)
  })

  it('writes RSS, links it from page heads, and requires hostname', async () => {
    const { root } = await site({
      'index.crv': '---\ntitle: Home\n---\n# Home\n\nAmpersand & text.\n',
    })
    await expect(build(root, { feed: {} })).rejects.toThrow(/feed requires hostname/)
    const outDir = await build(root, { hostname: 'https://example.com', feed: {} })
    const xml = await readFile(resolve(outDir, 'feed.xml'), 'utf8')
    const html = await readFile(resolve(outDir, 'index.html'), 'utf8')
    expect(xml).toContain('<rss version="2.0">')
    expect(xml).toContain('Ampersand &amp; text.')
    expect(html).toContain('rel="alternate" type="application/rss+xml"')
  })

  it('writes redirect HTML and _redirects while validating routes', async () => {
    const { root } = await site({
      'index.crv': '---\ntitle: Home\n---\n# Home\n',
      'new.crv': '---\ntitle: New\n---\n# New\n',
    })
    const outDir = await build(root, { redirects: { '/old': '/new' } })
    await expect(readFile(resolve(outDir, 'old/index.html'), 'utf8')).resolves.toContain('http-equiv="refresh"')
    await expect(readFile(resolve(outDir, '_redirects'), 'utf8')).resolves.toContain('/old /new 301')
    await expect(build(root, { redirects: { '/bad': '/missing' } })).rejects.toThrow(/redirect target/)
    await expect(build(root, { redirects: { '/new': '/' } })).rejects.toThrow(/collides/)
  })

  it('rejects a redirect source that would write outside the output directory', async () => {
    const { root } = await site({ 'index.crv': '---\ntitle: Home\n---\n# Home\n' })

    await expect(build(root, { redirects: { '/../outside': '/' } })).rejects.toThrow(
      /not a site route/,
    )
  })

  it('reports a blog config with no dir instead of crashing', async () => {
    const { root } = await site({ 'index.crv': '---\ntitle: Home\n---\n# Home\n' })

    await expect(build(root, { blog: {} })).rejects.toThrow(/blog\.dir is required/)
  })

  it('adds image loading defaults and intrinsic dimensions when probeable', async () => {
    const { root } = await site({
      'index.crv': '---\ntitle: Home\n---\n# Home\n\n![Logo](/logo.png)\n',
    })
    await mkdir(resolve(root, 'public'))
    await writeFile(
      resolve(root, 'public/logo.png'),
      Buffer.from('89504e470d0a1a0a0000000d4948445200000003000000020806000000', 'hex'),
    )
    const outDir = await build(root)
    const html = await readFile(resolve(outDir, 'index.html'), 'utf8')
    expect(html).toContain('loading="lazy"')
    expect(html).toContain('decoding="async"')
    expect(html).toContain('width="3"')
    expect(html).toContain('height="2"')
  })

  it('never probes outside the public directory', async () => {
    const { root } = await site({
      'index.crv': '---\ntitle: Home\n---\n# Home\n\n![Escape](/../outside.png)\n![Relative](sibling.png)\n',
    })
    await mkdir(resolve(root, 'public'))
    const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000003000000020806000000', 'hex')
    await writeFile(resolve(root, '..', 'outside.png'), png)
    await writeFile(resolve(root, 'sibling.png'), png)

    const outDir = await build(root)
    const html = await readFile(resolve(outDir, 'index.html'), 'utf8')

    // Both images still get the loading defaults; neither gets dimensions from
    // a file the build had no business reading or guessing at.
    expect((html.match(/loading="lazy"/g) ?? []).length).toBe(2)
    expect(html).not.toContain('width="3"')
  })

  it('emits social metadata with page image winning over the site default', async () => {
    const { root } = await site({
      'index.crv': '---\ntitle: Home\ndescription: Page desc\nimage: /page.png\n---\n# Home\n',
    })
    const outDir = await build(root, {
      hostname: 'https://example.com',
      themeConfig: { sidebar: {}, socialImage: '/site.png' },
    })
    const html = await readFile(resolve(outDir, 'index.html'), 'utf8')
    expect(html).toContain('property="og:title" content="Home"')
    expect(html).toContain('property="og:image" content="https://example.com/page.png"')
    expect(html).toContain('name="twitter:image" content="https://example.com/page.png"')
  })
})

