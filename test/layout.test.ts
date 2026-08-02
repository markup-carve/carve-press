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

  it('emits the inline theme bootstrap script in the head before the stylesheet', () => {
    const html = htmlDocument({
      lang: 'en-US',
      title: 'Start',
      head: [],
      base: '/',
      body: '',
    })
    const scriptIndex = html.indexOf("localStorage.getItem('carve-press-theme')")
    const stylesheetIndex = html.indexOf('<link rel="stylesheet"')
    expect(scriptIndex).toBeGreaterThan(-1)
    expect(stylesheetIndex).toBeGreaterThan(scriptIndex)
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

  it('renders configured top nav links and marks the current route', () => {
    const withNav = resolveConfig({
      title: 'Carve',
      base: '/carve/',
      themeConfig: {
        nav: [
          { text: 'Home', link: '/' },
          { text: 'Start', link: '/start' },
        ],
      },
    })
    const html = docLayout({ config: withNav, rendered, sidebar: [] })
    expect(html).toContain('<nav class="site-nav" aria-label="Primary">')
    expect(html).toContain('<a class="site-nav__link" href="/carve/">Home</a>')
    expect(html).toContain(
      '<a class="site-nav__link" href="/carve/start" aria-current="page">Start</a>',
    )
  })

  it('renders configured dropdown nav children', () => {
    const withDropdown = resolveConfig({
      title: 'Carve',
      themeConfig: {
        nav: [
          {
            text: 'Guide',
            link: '/start',
            items: [
              { text: 'Deep', link: '/guide/deep' },
              { text: 'External', link: 'https://example.com' },
            ],
          },
        ],
      },
    })
    const html = docLayout({ config: withDropdown, rendered, sidebar: [] })
    expect(html).toContain('<details class="site-nav__dropdown">')
    expect(html).toContain('<summary aria-current="page">Guide</summary>')
    expect(html).toContain('<a class="site-nav__dropdown-link" href="/guide/deep">Deep</a>')
    expect(html).toContain(
      '<a class="site-nav__dropdown-link" href="https://example.com">External</a>',
    )
  })

  it('renders configured social links with accessible names', () => {
    const withSocial = resolveConfig({
      title: 'Carve',
      themeConfig: {
        socialLinks: [
          { icon: 'github', link: 'https://github.com/markup-carve/carve-press' },
          { icon: 'mastodon', link: 'https://example.com/@carve' },
        ],
      },
    })
    const html = docLayout({ config: withSocial, rendered, sidebar: [] })
    expect(html).toContain('aria-label="github"')
    expect(html).toContain('<svg viewBox="0 0 16 16"')
    expect(html).toContain('aria-label="mastodon"><span>mastodon</span></a>')
  })

  it('renders configured footer fields', () => {
    const withFooter = resolveConfig({
      title: 'Carve',
      themeConfig: {
        footer: { message: 'Released under MIT.', copyright: 'Copyright 2026' },
      },
    })
    const html = docLayout({ config: withFooter, rendered, sidebar: [] })
    expect(html).toContain('<footer class="site-footer">')
    expect(html).toContain('<p class="site-footer__message">Released under MIT.</p>')
    expect(html).toContain('<p class="site-footer__copyright">Copyright 2026</p>')
  })

  it('renders the theme toggle button', () => {
    const html = docLayout({ config, rendered, sidebar: [] })
    expect(html).toContain(
      '<button class="theme-toggle" type="button" data-theme-toggle aria-label="Switch to dark theme">',
    )
  })

  it('omits optional site chrome sections when they are not configured', () => {
    const bare = resolveConfig({ title: 'Carve' })
    const html = docLayout({ config: bare, rendered, sidebar: [] })
    expect(html).not.toContain('class="site-nav"')
    expect(html).not.toContain('class="social-links"')
    expect(html).not.toContain('class="site-footer"')
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
