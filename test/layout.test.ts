import { describe, it, expect } from 'vitest'
import { htmlDocument, docLayout, homeLayout, pageLayout } from '../src/layout/doc.js'
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
    expect(html).toContain('<nav class="site-nav" id="site-nav-drawer" aria-label="Primary"')
    expect(html).toContain('<a class="site-nav__link" href="/carve/">Home</a>')
    expect(html).toContain(
      '<a class="site-nav__link" href="/carve/start" aria-current="page">Start</a>',
    )
  })

  it('renders mobile drawer controls for primary nav and sidebar', () => {
    const withNav = resolveConfig({
      title: 'Carve',
      themeConfig: { nav: [{ text: 'Start', link: '/start' }] },
    })
    const html = docLayout({
      config: withNav,
      rendered,
      sidebar: [{ text: 'Guide', items: [{ text: 'Start', link: '/start' }] }],
    })
    expect(html).toContain('data-drawer-toggle="sidebar"')
    expect(html).toContain('aria-controls="site-sidebar-drawer"')
    expect(html).toContain('data-drawer-toggle="nav"')
    expect(html).toContain('aria-controls="site-nav-drawer"')
    expect(html).toContain('data-drawer-scrim hidden')
    expect(html).toContain('<script src="/assets/nav.js" defer></script>')
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
    expect(html).toContain('aria-label="mastodon"><svg')
  })

  it('keeps text fallback for unknown social icons', () => {
    const withSocial = resolveConfig({
      title: 'Carve',
      themeConfig: { socialLinks: [{ icon: 'forum', link: 'https://example.com/forum' }] },
    })
    const html = docLayout({ config: withSocial, rendered, sidebar: [] })
    expect(html).toContain('aria-label="forum"><span>forum</span></a>')
  })

  it('renders safe custom social SVG and rejects unsafe custom SVG', () => {
    const safe = resolveConfig({
      title: 'Carve',
      themeConfig: {
        socialLinks: [
          {
            icon: { svg: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M0 0h16v16H0z"/></svg>' },
            link: 'https://example.com/custom',
          },
        ],
      },
    })
    expect(docLayout({ config: safe, rendered, sidebar: [] })).toContain(
      'aria-label="https://example.com/custom"><svg',
    )

    const unsafe = resolveConfig({
      title: 'Carve',
      themeConfig: {
        socialLinks: [
          {
            icon: {
              svg: '<svg onclick="alert(1)"><script>alert(2)</script><a xlink:href="javascript:alert(3)">link</a><circle r="4"/></svg>',
            },
            link: 'https://example.com/unsafe',
          },
        ],
      },
    })
    const page = docLayout({ config: unsafe, rendered, sidebar: [] })
    // Scoped to the icon: the page has its own legitimate script tags.
    const icon = /<div class="social-links">.*?<\/div>/s.exec(page)?.[0] ?? ''
    // Sanitized, not pattern-matched: the handler, the script, and the
    // javascript: URL are gone while the drawable shape survives.
    expect(icon).not.toContain('onclick')
    expect(icon).not.toContain('<script')
    expect(icon).not.toContain('javascript:')
    expect(icon).toContain('<circle')

    const malformed = resolveConfig({
      title: 'Carve',
      themeConfig: {
        socialLinks: [{ icon: { svg: 'not markup at all' }, link: 'https://example.com/broken' }],
      },
    })
    expect(() => docLayout({ config: malformed, rendered, sidebar: [] })).toThrow(
      /not a well-formed <svg>/,
    )
  })

  it('renders base-aware logo variants and site title overrides', () => {
    const withLogo = resolveConfig({
      title: 'Carve',
      base: '/docs/',
      themeConfig: {
        logo: { light: '/logo-light.svg', dark: '/logo-dark.svg', alt: 'Mark' },
        siteTitle: 'Press',
      },
    })
    const html = docLayout({ config: withLogo, rendered, sidebar: [] })
    expect(html).toContain('src="/docs/logo-light.svg" alt="Mark"')
    expect(html).toContain('src="/docs/logo-dark.svg" alt="Mark"')
    expect(html).toContain('<span class="site-title__text">Press</span>')
  })

  it('can hide the site title next to the logo', () => {
    const withLogoOnly = resolveConfig({
      title: 'Carve',
      themeConfig: { logo: '/logo.svg', siteTitle: false },
    })
    const html = docLayout({ config: withLogoOnly, rendered, sidebar: [] })
    expect(html).toContain('class="site-logo site-logo--single"')
    expect(html).not.toContain('site-title__text')
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

  it('renders the search control and client script', () => {
    const html = docLayout({ config, rendered, sidebar: [] })
    expect(html).toContain('class="site-search"')
    expect(html).toContain('data-search-index="/carve/assets/search-index.json"')
    expect(html).toContain('<label class="site-search__label" for="site-search-input">Search</label>')
    expect(html).toContain('<script src="/carve/assets/search.js" type="module"></script>')
  })

  it('loads the table overflow client script', () => {
    const html = docLayout({ config, rendered, sidebar: [] })
    expect(html).toContain('<script src="/carve/assets/table-scroll.js" defer></script>')
  })

  it('loads the code copy client script', () => {
    const html = docLayout({ config, rendered, sidebar: [] })
    expect(html).toContain('<script src="/carve/assets/code-copy.js" defer></script>')
  })

  it('loads the outline client script', () => {
    const html = docLayout({ config, rendered, sidebar: [] })
    expect(html).toContain('<script src="/carve/assets/outline.js" defer></script>')
  })

  it('omits search chrome when search is disabled', () => {
    const withoutSearch = resolveConfig({ title: 'Carve', search: false })
    const html = docLayout({ config: withoutSearch, rendered, sidebar: [] })
    expect(html).not.toContain('class="site-search"')
    expect(html).not.toContain('/assets/search.js')
  })

  it('loads the playground client only for pages with a playground', () => {
    const html = docLayout({
      config,
      rendered: { ...rendered, html: '<carve-playground></carve-playground>' } as RenderedPage,
      sidebar: [],
    })
    expect(html).toContain('<script src="/carve/assets/playground.js" type="module"></script>')
    expect(docLayout({ config, rendered, sidebar: [] })).not.toContain('/assets/playground.js')
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

  it('renders nested sidebar items recursively and marks the current route', () => {
    const html = docLayout({
      config,
      rendered,
      sidebar: [
        {
          text: 'Guide',
          items: [
            {
              text: 'Start',
              link: '/start',
              items: [{ text: 'Deep', link: '/guide/deep' }],
            },
          ],
        },
      ],
    })

    expect(html).toContain('<li class="sidebar__item sidebar__item--l1">')
    expect(html).toContain('<li class="sidebar__item sidebar__item--l2">')
    expect(html).toContain('<a href="/carve/start" aria-current="page">Start</a>')
    expect(html).toContain('<a href="/carve/guide/deep">Deep</a>')
  })

  it('renders collapsed sidebar groups as details and opens the current group', () => {
    const html = docLayout({
      config,
      rendered,
      sidebar: [
        { text: 'Closed', collapsed: true, items: [{ text: 'Home', link: '/' }] },
        { text: 'Current', collapsed: true, items: [{ text: 'Start', link: '/start' }] },
        { text: 'Open', collapsed: false, items: [{ text: 'Deep', link: '/guide/deep' }] },
      ],
    })

    expect(html).toContain('<details class="sidebar-group"><summary class="sidebar-group__title">Closed</summary>')
    expect(html).toContain('<details class="sidebar-group" open><summary class="sidebar-group__title">Current</summary>')
    expect(html).toContain('<details class="sidebar-group" open><summary class="sidebar-group__title">Open</summary>')
  })

  it('renders prev and next links when present', () => {
    const html = docLayout({
      config,
      rendered,
      sidebar: [],
      prev: { text: 'Home', link: '/' },
      next: { text: 'Guide', link: '/guide/' },
    })
    expect(html).toContain('<nav class="page-nav" aria-label="Page navigation">')
    expect(html).toContain('<span class="page-nav__eyebrow">Previous</span>')
    expect(html).toContain('<span class="page-nav__title">Home</span>')
    expect(html).toContain('<a class="page-nav__next" rel="next" href="/carve/guide/">')
    expect(html).toContain('<span class="page-nav__eyebrow">Next</span>')
    expect(html).toContain('<span class="page-nav__title">Guide</span>')
  })

  it('omits last updated by default', () => {
    const html = docLayout({ config, rendered, sidebar: [], lastUpdated: new Date('2026-01-02T03:04:05.000Z') })
    expect(html).not.toContain('class="last-updated"')
  })

  it('renders last updated as a time element when enabled', () => {
    const withLastUpdated = resolveConfig({
      title: 'Carve',
      themeConfig: { lastUpdated: true },
    })
    const html = docLayout({
      config: withLastUpdated,
      rendered,
      sidebar: [],
      lastUpdated: new Date('2026-01-02T03:04:05.000Z'),
    })
    expect(html).toContain(
      '<p class="last-updated">Last updated <time datetime="2026-01-02T03:04:05.000Z">',
    )
  })

  it('omits canonical and og:url without a hostname', () => {
    const html = docLayout({ config, rendered, sidebar: [] })
    expect(html).not.toContain('rel="canonical"')
    expect(html).not.toContain('property="og:url"')
  })

  it('emits per-page canonical and og:url for a nested route with base', () => {
    const withHostname = resolveConfig({
      title: 'Carve',
      hostname: 'https://example.com',
      base: '/docs/',
    })
    const nested = {
      ...rendered,
      page: { ...rendered.page, route: '/guide/deep', relPath: 'guide/deep.crv' },
    } as RenderedPage
    const html = docLayout({ config: withHostname, rendered: nested, sidebar: [] })
    expect(html).toContain('<link rel="canonical" href="https://example.com/docs/guide/deep">')
    expect(html).toContain('<meta property="og:url" content="https://example.com/docs/guide/deep">')
  })

  it('lets user-supplied og:url suppress the generated one', () => {
    const withUserOg = resolveConfig({
      title: 'Carve',
      hostname: 'https://example.com',
      head: [['meta', { property: 'og:url', content: 'https://canonical.example/custom' }]],
    })
    const html = docLayout({ config: withUserOg, rendered, sidebar: [] })
    expect(html).toContain('<meta property="og:url" content="https://canonical.example/custom">')
    expect(html).not.toContain('<meta property="og:url" content="https://example.com/start">')
    expect(html).toContain('<link rel="canonical" href="https://example.com/start">')
  })

  it('normalizes generated page URLs without double slashes', () => {
    const withMessyUrlParts = resolveConfig({
      title: 'Carve',
      hostname: 'https://example.com/',
      base: '/docs/',
    })
    const nested = {
      ...rendered,
      page: { ...rendered.page, route: '/guide/deep', relPath: 'guide/deep.crv' },
    } as RenderedPage
    const html = docLayout({ config: withMessyUrlParts, rendered: nested, sidebar: [] })
    expect(html).toContain('https://example.com/docs/guide/deep')
    expect(html).not.toContain('https://example.com//')
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

describe('homeLayout', () => {
  it('escapes author-supplied feature details', () => {
    const config = resolveConfig({ title: 'Carve' })
    const homeRendered = {
      ...rendered,
      page: {
        ...rendered.page,
        route: '/',
        frontmatter: {
          title: 'Home',
          features: [{ title: 'Feature', details: 'See <details>' }],
        },
      },
      searchDoc: { ...rendered.searchDoc, route: '/', title: 'Home' },
    } as unknown as RenderedPage

    const html = homeLayout({ config, rendered: homeRendered, sidebar: [] })
    expect(html).toContain('See &lt;details&gt;')
    expect(html).not.toContain('<p>See <details></p>')
  })
})

describe('pageLayout', () => {
  it('renders header, content, and footer without sidebar or outline', () => {
    const config = resolveConfig({
      title: 'Carve',
      themeConfig: { footer: { message: 'MIT', copyright: 'Copyright' } },
    })
    const html = pageLayout({ config, rendered, sidebar: [] })
    expect(html).toContain('<header class="site-header">')
    expect(html).toContain('<main class="page-layout content">')
    expect(html).toContain('<footer class="site-footer">')
    expect(html).not.toContain('class="sidebar"')
    expect(html).not.toContain('class="outline"')
  })
})

describe('mobile drawer toggles', () => {
  const sidebar = [{ text: 'Guide', items: [{ text: 'Start', link: '/start' }] }]

  it('offers the sidebar toggle only on layouts that render the sidebar', () => {
    const config = resolveConfig({ title: 'Carve' })

    const doc = docLayout({ config, rendered, sidebar })
    const page = pageLayout({ config, rendered, sidebar })
    const home = homeLayout({ config, rendered, sidebar })

    expect(doc).toContain('data-drawer-toggle="sidebar"')
    expect(doc).toContain('id="site-sidebar-drawer"')
    // A toggle whose target is not on the page is a button that does nothing.
    expect(page).not.toContain('data-drawer-toggle="sidebar"')
    expect(home).not.toContain('data-drawer-toggle="sidebar"')
  })
})
