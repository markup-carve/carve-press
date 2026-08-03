import { describe, it, expect } from 'vitest'
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { buildSite } from '../src/build.js'
import type { SiteExtension } from '../src/config.js'
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
  it('keeps the post date, byline, and tags as separate elements', async () => {
    const { root } = await site({
      'index.crv': '---\ntitle: Home\n---\n# Home\n',
      'blog/a.crv':
        '---\ntitle: A\ndate: 2026-01-01\ntags: [News, Release]\nauthor: Ada\n---\n# A\n\nAlpha body.\n',
    })
    const outDir = await build(root, { blog: { dir: 'blog', route: '/blog/' } })

    const post = await readFile(resolve(outDir, 'blog/a/index.html'), 'utf8')
    // Joining these into one string ran them together on the page, so the
    // markup has to keep them apart.
    expect(post).toContain('<time class="blog-meta__date" datetime="2026-01-01">January 1, 2026</time>')
    expect(post).toContain('<span class="blog-meta__author">Ada</span>')
    expect(post).toContain('<ul class="tag-list">')
    expect(post).toContain('/blog/tags/news/')
    expect(post).not.toContain('2026-01-01Ada')

    const index = await readFile(resolve(outDir, 'blog/index.html'), 'utf8')
    const heading = /<h2[^>]*>(.*?)<\/h2>/s.exec(index)?.[1] ?? ''
    // Carve folds the lines under a heading into it, which is how the date and
    // the tags ended up inside the card title.
    expect(heading).toContain('A')
    expect(heading).not.toContain('2026-01-01')
    expect(index).toContain('blog-card__meta')
    expect(index).toContain('blog-card__tags')
  })

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

  it('points the feed at the site under its base, not at the domain root', async () => {
    const { root } = await site({ 'index.crv': '---\ntitle: Home\n---\n# Home\n' })

    const rssDir = await build(root, {
      hostname: 'https://example.github.io',
      base: '/project/',
      feed: {},
    })
    const rss = await readFile(resolve(rssDir, 'feed.xml'), 'utf8')
    // Scoped to the channel head: every item link already starts with the base,
    // so a whole-document match passes whether or not the channel is right.
    const channel = rss.slice(0, rss.indexOf('<item>'))
    expect(channel).toContain('<link>https://example.github.io/project/</link>')

    const atomDir = await build(root, {
      hostname: 'https://example.github.io',
      base: '/project/',
      feed: { type: 'atom' },
    })
    const atom = await readFile(resolve(atomDir, 'feed.xml'), 'utf8')
    const head = atom.slice(0, atom.indexOf('<entry>'))
    expect(head).toContain('<link href="https://example.github.io/project/"/>')
    expect(head).toContain('<id>https://example.github.io/project/</id>')
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

  it('emits redirectFrom frontmatter through the redirects output path', async () => {
    const { root } = await site({
      'index.crv': '---\ntitle: Home\n---\n# Home\n',
      'guide.crv': '---\ntitle: Guide\nredirectFrom:\n  - /old-guide/\n  - /install\n---\n# Guide\n',
    })
    const outDir = await build(root)

    await expect(readFile(resolve(outDir, 'old-guide/index.html'), 'utf8')).resolves.toContain(
      'http-equiv="refresh"',
    )
    await expect(readFile(resolve(outDir, 'install/index.html'), 'utf8')).resolves.toContain('/guide')
    const redirects = await readFile(resolve(outDir, '_redirects'), 'utf8')
    expect(redirects).toContain('/old-guide/ /guide 301')
    expect(redirects).toContain('/install /guide 301')
  })

  it('rejects invalid redirectFrom frontmatter with page and key', async () => {
    const { root } = await site({
      'index.crv': '---\ntitle: Home\nredirectFrom: { old: /old }\n---\n# Home\n',
    })

    await expect(build(root)).rejects.toMatchObject({
      name: 'SourceError',
      srcPath: 'index.crv',
      message: 'frontmatter: invalid redirectFrom',
    } satisfies Partial<SourceError>)
  })

  it('validates redirectFrom sources like configured redirect sources', async () => {
    const { root } = await site({
      'index.crv': '---\ntitle: Home\nredirectFrom: old\n---\n# Home\n',
    })

    await expect(build(root)).rejects.toThrow(/redirect source old is not a site route/)
  })

  it('rejects redirectFrom collisions with config redirects and other pages', async () => {
    const configCollision = await site({
      'index.crv': '---\ntitle: Home\n---\n# Home\n',
      'new.crv': '---\ntitle: New\nredirectFrom: /old\n---\n# New\n',
    })
    await expect(build(configCollision.root, { redirects: { '/old': '/' } })).rejects.toThrow(
      /config redirects\["\/old"\].*new\.crv redirectFrom/s,
    )

    const pageCollision = await site({
      'index.crv': '---\ntitle: Home\n---\n# Home\n',
      'a.crv': '---\ntitle: A\nredirectFrom: /old\n---\n# A\n',
      'b.crv': '---\ntitle: B\nredirectFrom: /old\n---\n# B\n',
    })
    await expect(build(pageCollision.root)).rejects.toThrow(/a\.crv redirectFrom.*b\.crv redirectFrom/s)
  })

  it('does not emit redirectFrom from drafts', async () => {
    const { root } = await site({
      'index.crv': '---\ntitle: Home\n---\n# Home\n',
      'draft.crv': '---\ntitle: Draft\ndraft: true\nredirectFrom: /old-draft\n---\n# Draft\n',
    })
    const outDir = await build(root)

    await expect(readFile(resolve(outDir, 'draft/index.html'), 'utf8')).resolves.toContain('Draft')
    await expect(readFile(resolve(outDir, '_redirects'), 'utf8')).rejects.toThrow()
  })

  it('emits redirectFrom from blog posts and virtual pages', async () => {
    const virtualPage: SiteExtension = {
      name: 'virtual-test-page',
      setup(bus) {
        bus.on('contentDiscovered', (payload) => {
          payload.pages.push({
            route: '/virtual',
            srcPath: resolve(payload.pages[0]!.srcPath, '../virtual.crv'),
            relPath: 'virtual.crv',
            frontmatter: { title: 'Virtual', redirectFrom: '/old-virtual', virtual: true },
            source: '# Virtual\n',
            bodyStartLine: 1,
          })
        })
      },
    }
    const { root } = await site({
      'index.crv': '---\ntitle: Home\n---\n# Home\n',
      'blog/a.crv': '---\ntitle: A\ndate: 2026-01-01\nredirectFrom: /old-post\n---\n# A\n',
    })
    const outDir = await build(root, { blog: { dir: 'blog', route: '/blog/' }, extensions: [virtualPage] })
    const redirects = await readFile(resolve(outDir, '_redirects'), 'utf8')

    expect(redirects).toContain('/old-post /blog/a 301')
    expect(redirects).toContain('/old-virtual /virtual 301')
  })

  it('creates and updates the route manifest without including redirect stubs', async () => {
    const { root } = await site({
      'index.crv': '---\ntitle: Home\n---\n# Home\n',
      'new.crv': '---\ntitle: New\n---\n# New\n',
    })

    await build(root, { redirects: { '/old': '/new' } })
    await expect(readFile(resolve(root, 'routes.json'), 'utf8')).resolves.toBe('[\n  "/",\n  "/new"\n]\n')

    await writeFile(resolve(root, 'docs/new.crv'), '---\ntitle: New\nredirectFrom: /start\n---\n# New\n')
    await build(root)
    await expect(readFile(resolve(root, 'routes.json'), 'utf8')).resolves.toBe('[\n  "/",\n  "/new"\n]\n')
  })

  it('fails every missing manifest route not covered by redirects', async () => {
    const { root } = await site({
      'index.crv': '---\ntitle: Home\n---\n# Home\n',
      'new.crv': '---\ntitle: New\nredirectFrom: /old-a\n---\n# New\n',
    })
    await writeFile(resolve(root, 'routes.json'), '[\n  "/",\n  "/old-a",\n  "/old-b",\n  "/old-c",\n  "/old-d"\n]\n')

    // Asserted through format(), which is what the author actually reads: the
    // summary carries the count, the details carry every missing route.
    const error = await build(root, {
      ignoreDeadLinks: true,
      redirects: { '/old-b': '/new' },
    }).then(
      () => undefined,
      (thrown: unknown) => thrown as { format: () => string },
    )

    expect(error).toBeDefined()
    const report = error!.format()
    expect(report).toContain('2 published route(s) disappeared without a redirect')
    expect(report).toContain('/old-c')
    expect(report).toContain('/old-d')
    expect(report).toContain('add redirectFrom to the page that replaced it')
    // Covered by a redirect, so not reported.
    expect(report).not.toContain('/old-a')
    expect(report).not.toContain('/old-b')
  })

  it('writes a configured route manifest and lets false disable the check', async () => {
    const { root } = await site({
      'index.crv': '---\ntitle: Home\n---\n# Home\n',
    })
    await writeFile(resolve(root, 'routes.json'), '[\n  "/gone"\n]\n')

    await build(root, { routeManifest: false })
    await expect(readFile(resolve(root, 'routes.json'), 'utf8')).resolves.toContain('/gone')

    await build(root, { routeManifest: 'state/routes.json' })
    await expect(readFile(resolve(root, 'state/routes.json'), 'utf8')).resolves.toBe('[\n  "/"\n]\n')
  })

  it('builds pages at rewritten routes and rejects a rewrite that matches nothing', async () => {
    const { root } = await site({
      'index.crv': '---\ntitle: Home\n---\n# Home\n\n[Deep](/a/guide/start)\n',
      'packages/a/docs/guide/start.crv': '---\ntitle: Start\n---\n# Start\n',
    })

    const outDir = await build(root, { rewrites: { 'packages/a/docs/*': '/a/*' } })

    // Published where the rewrite says, and the link to it validates.
    await expect(readFile(resolve(outDir, 'a/guide/start/index.html'), 'utf8')).resolves.toContain('Start')
    await expect(
      readFile(resolve(outDir, 'packages/a/docs/guide/start/index.html'), 'utf8'),
    ).rejects.toThrow()

    await expect(build(root, { rewrites: { 'packages/b/*': '/b/*' } })).rejects.toThrow(
      /match no source file/,
    )
  })

  it('expands a prefix pattern into one stub per page, keeping the splat for hosts', async () => {
    const { root } = await site({
      'index.crv': '---\ntitle: Home\n---\n# Home\n',
      'guide/a.crv': '---\ntitle: A\n---\n# A\n',
      'guide/b.crv': '---\ntitle: B\n---\n# B\n',
    })

    const outDir = await build(root, { redirects: { '/docs/*': '/guide/*' } })

    // A static host cannot match a pattern, so each page gets its own stub.
    const a = await readFile(resolve(outDir, 'docs/a/index.html'), 'utf8')
    const b = await readFile(resolve(outDir, 'docs/b/index.html'), 'utf8')
    expect(a).toContain('url=/guide/a')
    expect(b).toContain('url=/guide/b')

    // The host file keeps one line, because a host that understands a splat
    // should not be handed the expansion.
    const hostFile = await readFile(resolve(outDir, '_redirects'), 'utf8')
    expect(hostFile.trim()).toBe('/docs/* /guide/* 301')
  })

  it('rejects a prefix pattern whose target is not one, or which matches nothing', async () => {
    const { root } = await site({
      'index.crv': '---\ntitle: Home\n---\n# Home\n',
      'guide/a.crv': '---\ntitle: A\n---\n# A\n',
    })

    await expect(build(root, { redirects: { '/docs/*': '/guide/a' } })).rejects.toThrow(
      /target must be one too/,
    )
    await expect(build(root, { redirects: { '/docs/*': '/nothing/*' } })).rejects.toThrow(
      /matches no pages/,
    )
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
