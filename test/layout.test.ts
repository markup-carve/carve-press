import { describe, it, expect } from 'vitest'
import { htmlDocument, docLayout } from '../src/layout/doc.js'
import { resolveConfig } from '../src/config.js'
import type { RenderedPage } from '../src/render/page.js'

const rendered = {
  page: { route: '/start', relPath: 'start.crv', frontmatter: { title: 'Start' } },
  html: '<h1>Start</h1>',
  outline: [{ level: 2, title: 'Install', slug: 'install' }],
  searchDoc: { route: '/start', title: 'Start', headings: ['Install'], text: '' },
} as unknown as RenderedPage

describe('htmlDocument', () => {
  it('emits a complete document with title, description, and head tags', () => {
    const html = htmlDocument({
      lang: 'en-US',
      title: 'Start | Carve',
      description: 'D',
      head: [['meta', { property: 'og:title', content: 'Carve' }]],
      base: '/carve/',
      body: '<main></main>',
    })
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<html lang="en-US">')
    expect(html).toContain('<title>Start | Carve</title>')
    expect(html).toContain('<meta name="description" content="D">')
    expect(html).toContain('<meta property="og:title" content="Carve">')
  })

  it('escapes attribute values in head tags', () => {
    const html = htmlDocument({
      lang: 'en',
      title: 'T',
      head: [['meta', { content: '"><script>alert(1)</script>' }]],
      base: '/',
      body: '',
    })
    expect(html).not.toContain('<script>alert(1)')
    expect(html).toContain('&quot;&gt;')
  })
})

describe('docLayout', () => {
  const config = resolveConfig({
    title: 'Carve',
    base: '/carve/',
    themeConfig: {
      editLink: { pattern: 'https://example.com/edit/:path', text: 'Edit' },
    },
  })

  it('renders the page body inside a main content region', () => {
    const html = docLayout({ config, rendered, sidebar: [] })
    expect(html).toContain('<h1>Start</h1>')
    expect(html).toContain('class="content"')
  })

  it('composes the document title from the page and site titles', () => {
    expect(docLayout({ config, rendered, sidebar: [] })).toContain('<title>Start | Carve</title>')
  })

  it('renders the outline as a nav list of anchors', () => {
    const html = docLayout({ config, rendered, sidebar: [] })
    expect(html).toContain('href="#install"')
    expect(html).toContain('Install')
  })

  it('renders prev and next links when present', () => {
    const html = docLayout({
      config,
      rendered,
      sidebar: [],
      prev: { text: 'Home', link: '/' },
      next: { text: 'Guide', link: '/guide/' },
    })
    expect(html).toContain('href="/carve/"')
    expect(html).toContain('href="/carve/guide/"')
  })

  it('expands :path in the edit link', () => {
    const html = docLayout({ config, rendered, sidebar: [] })
    expect(html).toContain('https://example.com/edit/start.crv')
  })

  it('omits the edit link when none is configured', () => {
    const bare = resolveConfig({ title: 'Carve' })
    expect(docLayout({ config: bare, rendered, sidebar: [] })).not.toContain('edit-link')
  })
})
