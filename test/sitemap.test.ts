import { describe, it, expect } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { resolveConfig } from '../src/config.js'
import { BuildEventBus } from '../src/events.js'
import { sitemap } from '../src/extensions/sitemap.js'
import type { RenderedPage } from '../src/render/page.js'

function renderedPage(route: string, title = 'Page'): RenderedPage {
  return {
    page: {
      route,
      srcPath: resolve(import.meta.dirname, 'fixtures/site/start.crv'),
      relPath: 'start.crv',
      frontmatter: { title },
      source: '# Page\n',
      bodyStartLine: 1,
    },
    html: '<h1>Page</h1>',
    outline: [],
    searchDoc: { route, title, headings: [], sections: [], text: '' },
  }
}

async function emitSitemap(rendered: RenderedPage[], base = '/', opts = {}) {
  const outDir = await mkdtemp(resolve(tmpdir(), 'cp-sitemap-'))
  const bus = new BuildEventBus()
  sitemap({ hostname: 'https://example.com/', ...opts }).setup(bus)
  await bus.emit('buildStarted', { config: resolveConfig({ title: 'Carve', base }) })
  await bus.emit('buildCompleted', { rendered, outDir })
  return outDir
}

describe('sitemap', () => {
  it('writes sitemap.xml on buildCompleted with one entry per page', async () => {
    const outDir = await emitSitemap([renderedPage('/'), renderedPage('/guide/')])
    const xml = await readFile(resolve(outDir, 'sitemap.xml'), 'utf8')
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
    expect(xml.match(/<url>/g)).toHaveLength(2)
    expect(xml).toContain('<loc>https://example.com/</loc>')
    expect(xml).toContain('<loc>https://example.com/guide/</loc>')
  })

  it('joins hostname, root base, and route without missing or doubled slashes', async () => {
    const outDir = await emitSitemap([renderedPage('/guide/')], '/')
    const xml = await readFile(resolve(outDir, 'sitemap.xml'), 'utf8')
    expect(xml).toContain('<loc>https://example.com/guide/</loc>')
    expect(xml).not.toContain('example.com//guide')
  })

  it('joins hostname, nested base, and route without missing or doubled slashes', async () => {
    const outDir = await emitSitemap([renderedPage('/guide/')], '/carve/')
    const xml = await readFile(resolve(outDir, 'sitemap.xml'), 'utf8')
    expect(xml).toContain('<loc>https://example.com/carve/guide/</loc>')
    expect(xml).not.toContain('/carve//guide')
  })

  it('XML-escapes every URL', async () => {
    const outDir = await emitSitemap([renderedPage('/search/?q=a&b=c')])
    const xml = await readFile(resolve(outDir, 'sitemap.xml'), 'utf8')
    expect(xml).toContain('<loc>https://example.com/search/?q=a&amp;b=c</loc>')
  })

  it('omits excluded routes', async () => {
    const outDir = await emitSitemap(
      [renderedPage('/keep/'), renderedPage('/drop/')],
      '/',
      { exclude: ['/drop/'] },
    )
    const xml = await readFile(resolve(outDir, 'sitemap.xml'), 'utf8')
    expect(xml).toContain('/keep/')
    expect(xml).not.toContain('/drop/')
  })

  it('honors a custom filename', async () => {
    const outDir = await emitSitemap([renderedPage('/guide/')], '/', {
      filename: 'feeds/site.xml',
    })
    const xml = await readFile(resolve(outDir, 'feeds/site.xml'), 'utf8')
    expect(xml).toContain('<loc>https://example.com/guide/</loc>')
  })
})
