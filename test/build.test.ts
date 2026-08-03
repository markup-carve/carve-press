import { describe, it, expect } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { buildSite, loadConfig } from '../src/build.js'

const SITE = resolve(import.meta.dirname, 'fixtures/site')

async function build(over: object = {}, root = SITE) {
  const outDir = await mkdtemp(resolve(tmpdir(), 'cp-out-'))
  const result = await buildSite({
    root,
    config: {
      title: 'Fixture',
      srcDir: SITE,
      outDir,
      themeConfig: {
        sidebar: {
          '/': [
            {
              text: 'G',
              items: [
                { text: 'Home', link: '/' },
                { text: 'Start', link: '/start' },
              ],
            },
          ],
        },
      },
      ...over,
    },
  })
  return { result, outDir }
}

describe('buildSite', () => {
  it('writes an HTML file per route', async () => {
    const { result, outDir } = await build()
    expect(result.routes.sort()).toEqual(['/', '/draft', '/guide/', '/guide/deep', '/start'])
    expect((await readdir(outDir)).sort()).toContain('start')
    const html = await readFile(resolve(outDir, 'start/index.html'), 'utf8')
    expect(html).toContain('<h1>Start ')
    expect(html).toContain('<title>Start | Fixture</title>')
  })

  it('writes the shipped theme stylesheet', async () => {
    const { outDir } = await build()
    const actual = await readFile(resolve(outDir, 'assets/style.css'), 'utf8')
    const expected = await readFile(resolve(import.meta.dirname, '../theme/default.css'), 'utf8')
    expect(actual).toBe(expected)
  })

  it('writes the shipped search client script', async () => {
    const { outDir } = await build()
    const actual = await readFile(resolve(outDir, 'assets/search.js'), 'utf8')
    const expected = await readFile(resolve(import.meta.dirname, '../theme/search.js'), 'utf8')
    expect(actual).toBe(expected)
  })

  it('writes the MiniSearch browser module for the search client', async () => {
    const { outDir } = await build()
    const actual = await readFile(resolve(outDir, 'assets/minisearch.js'), 'utf8')
    expect(actual).toContain('export { MiniSearch as default }')
  })

  it('writes the shipped table overflow client script', async () => {
    const { outDir } = await build()
    const actual = await readFile(resolve(outDir, 'assets/table-scroll.js'), 'utf8')
    const expected = await readFile(resolve(import.meta.dirname, '../theme/table-scroll.js'), 'utf8')
    expect(actual).toBe(expected)
  })

  it('writes the shipped code copy client script', async () => {
    const { outDir } = await build()
    const actual = await readFile(resolve(outDir, 'assets/code-copy.js'), 'utf8')
    const expected = await readFile(resolve(import.meta.dirname, '../theme/code-copy.js'), 'utf8')
    expect(actual).toBe(expected)
  })

  it('writes the shipped outline client script', async () => {
    const { outDir } = await build()
    const actual = await readFile(resolve(outDir, 'assets/outline.js'), 'utf8')
    const expected = await readFile(resolve(import.meta.dirname, '../theme/outline.js'), 'utf8')
    expect(actual).toBe(expected)
  })

  it('writes the shipped mobile navigation client script', async () => {
    const { outDir } = await build()
    const actual = await readFile(resolve(outDir, 'assets/nav.js'), 'utf8')
    const expected = await readFile(resolve(import.meta.dirname, '../theme/nav.js'), 'utf8')
    expect(actual).toBe(expected)
  })

  it('writes playground assets only when a page contains a playground', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'cp-playground-'))
    const srcDir = resolve(root, 'docs')
    await mkdir(srcDir)
    await writeFile(
      resolve(srcDir, 'index.crv'),
      ['---', 'title: Play', '---', '', '# Play', '', '::: playground', '```carve', '*bold*', '```', ':::'].join(
        '\n',
      ),
    )

    const { outDir } = await build({ srcDir, themeConfig: { sidebar: {} } }, root)
    const script = await readFile(resolve(outDir, 'assets/playground.js'), 'utf8')
    expect(script).toBe(await readFile(resolve(import.meta.dirname, '../theme/playground.js'), 'utf8'))
    await expect(stat(resolve(outDir, 'assets/carve/index.js'))).resolves.toMatchObject({ size: expect.any(Number) })
    await expect(readFile(resolve(outDir, 'index.html'), 'utf8')).resolves.toContain('/assets/playground.js')

    const noPlayground = await build()
    await expect(readFile(resolve(noPlayground.outDir, 'assets/playground.js'), 'utf8')).rejects.toThrow()
    await expect(stat(resolve(noPlayground.outDir, 'assets/carve/index.js'))).rejects.toThrow()
  })

  it('copies configured playground runtime assets beside the playground client', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'cp-playground-assets-'))
    const srcDir = resolve(root, 'docs')
    const wasmDir = resolve(root, 'runtime/carve-wasm')
    await mkdir(srcDir)
    await mkdir(wasmDir, { recursive: true })
    await writeFile(resolve(wasmDir, 'carve_wasm.js'), 'export default async function init() {}\n')
    await writeFile(resolve(wasmDir, 'carve_wasm_bg.wasm'), 'wasm')
    await writeFile(resolve(root, 'runtime/mermaid.min.js'), 'window.mermaid = {}\n')
    await writeFile(resolve(root, 'runtime/chart.umd.js'), 'window.Chart = function Chart() {}\n')
    await writeFile(
      resolve(srcDir, 'index.crv'),
      ['---', 'title: Play', '---', '', '# Play', '', '::: playground', '```carve', '*bold*', '```', ':::'].join(
        '\n',
      ),
    )

    const { outDir } = await build(
      {
        base: '/docs/',
        srcDir,
        themeConfig: { sidebar: {} },
        playground: {
          wasmEngine: 'runtime/carve-wasm',
          mermaid: 'runtime/mermaid.min.js',
          chart: 'runtime/chart.umd.js',
        },
      },
      root,
    )

    await expect(readFile(resolve(outDir, 'assets/playground/carve-wasm/carve_wasm.js'), 'utf8')).resolves.toContain(
      'init',
    )
    await expect(readFile(resolve(outDir, 'assets/playground/carve-wasm/carve_wasm_bg.wasm'), 'utf8')).resolves.toBe(
      'wasm',
    )
    await expect(readFile(resolve(outDir, 'assets/playground/mermaid.min.js'), 'utf8')).resolves.toContain(
      'window.mermaid',
    )
    await expect(readFile(resolve(outDir, 'assets/playground/chart.umd.js'), 'utf8')).resolves.toContain(
      'window.Chart',
    )
    const html = await readFile(resolve(outDir, 'index.html'), 'utf8')
    expect(html).toContain('data-playground-wasm="/docs/assets/playground/carve-wasm/carve_wasm.js"')
    expect(html).toContain('data-playground-mermaid="/docs/assets/playground/mermaid.min.js"')
    expect(html).toContain('data-playground-chart="/docs/assets/playground/chart.umd.js"')

    const unconfigured = await build({ srcDir, themeConfig: { sidebar: {} } }, root)
    await expect(readdir(resolve(unconfigured.outDir, 'assets/playground'))).rejects.toThrow()
    await expect(readFile(resolve(unconfigured.outDir, 'index.html'), 'utf8')).resolves.not.toContain(
      'data-playground-wasm',
    )
  })

  it('does not emit search assets or chrome when search is disabled', async () => {
    const { outDir } = await build({ search: false })
    await expect(readFile(resolve(outDir, 'assets/search-index.json'), 'utf8')).rejects.toThrow()
    await expect(readFile(resolve(outDir, 'assets/search.js'), 'utf8')).rejects.toThrow()
    await expect(readFile(resolve(outDir, 'assets/minisearch.js'), 'utf8')).rejects.toThrow()
    const html = await readFile(resolve(outDir, 'start/index.html'), 'utf8')
    expect(html).not.toContain('class="site-search"')
    expect(html).not.toContain('/assets/search.js')
  })

  it('lets a configured stylesheet replace the shipped theme', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'cp-theme-'))
    await writeFile(resolve(root, 'theme.css'), 'body { color: rebeccapurple; }\n')

    const { outDir } = await build({ srcDir: SITE, theme: { css: 'theme.css' } }, root)
    await expect(readFile(resolve(outDir, 'assets/style.css'), 'utf8')).resolves.toBe(
      'body { color: rebeccapurple; }\n',
    )
  })

  it('appends extraCss after the shipped theme instead of replacing it', async () => {
    // Pointing `css` at a partial stylesheet silently discards the whole theme
    // and still builds successfully, so a site that only needs extra rules has
    // to be able to say that.
    const root = await mkdtemp(resolve(tmpdir(), 'cp-extra-'))
    await writeFile(resolve(root, 'pages.css'), '.impl-chart { display: grid; }\n')

    const { outDir } = await build({ srcDir: SITE, theme: { extraCss: ['pages.css'] } }, root)
    const css = await readFile(resolve(outDir, 'assets/style.css'), 'utf8')

    expect(css).toContain('.impl-chart { display: grid; }')
    expect(css).toContain('--verdigris')
  })

  it('appends every extraCss entry in order, after a replaced theme', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'cp-extra-order-'))
    await writeFile(resolve(root, 'theme.css'), 'body { color: rebeccapurple; }\n')
    await writeFile(resolve(root, 'a.css'), '.a {}\n')
    await writeFile(resolve(root, 'b.css'), '.b {}\n')

    const { outDir } = await build(
      { srcDir: SITE, theme: { css: 'theme.css', extraCss: ['a.css', 'b.css'] } },
      root,
    )
    const css = await readFile(resolve(outDir, 'assets/style.css'), 'utf8')

    expect(css.indexOf('rebeccapurple')).toBeLessThan(css.indexOf('.a {}'))
    expect(css.indexOf('.a {}')).toBeLessThan(css.indexOf('.b {}'))
  })

  it('copies publicDir contents into the output root', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'cp-public-'))
    await mkdir(resolve(root, 'static/images'), { recursive: true })
    await writeFile(resolve(root, 'static/favicon.ico'), 'ico')
    await writeFile(resolve(root, 'static/images/logo.txt'), 'logo')

    const { outDir } = await build({ srcDir: SITE, publicDir: 'static' }, root)
    await expect(readFile(resolve(outDir, 'favicon.ico'), 'utf8')).resolves.toBe('ico')
    await expect(readFile(resolve(outDir, 'images/logo.txt'), 'utf8')).resolves.toBe('logo')
  })

  it('does not fail when publicDir is missing', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'cp-missing-public-'))
    const { outDir } = await build({ srcDir: SITE, publicDir: 'missing' }, root)
    await expect(readFile(resolve(outDir, 'index.html'), 'utf8')).resolves.toContain('<h1>Home ')
  })

  it('emits the index page at the output root', async () => {
    const { outDir } = await build()
    const html = await readFile(resolve(outDir, 'index.html'), 'utf8')
    expect(html).toContain('<h1>Home ')
  })

  it('prefixes root-relative content links and images under a non-root base exactly once', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'cp-base-'))
    const srcDir = resolve(root, 'docs')
    await mkdir(srcDir)
    await writeFile(
      resolve(srcDir, 'index.crv'),
      ['---', 'title: Home', '---', '', '# Home', '', '[Start](/start)', '', '![Logo](/logo.png)'].join('\n'),
    )
    await writeFile(resolve(srcDir, 'start.crv'), ['---', 'title: Start', '---', '', '# Start'].join('\n'))

    const { outDir } = await build({ srcDir, base: '/carve-press/', themeConfig: { sidebar: {} } }, root)
    const html = await readFile(resolve(outDir, 'index.html'), 'utf8')

    expect(html).toContain('<a href="/carve-press/start">Start</a>')
    expect(html).toContain('<img src="/carve-press/logo.png" alt="Logo" loading="lazy" decoding="async">')
    expect(html).not.toContain('/carve-press/carve-press/')
  })

  it('reports a dead content link as authored under a non-root base', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'cp-base-dead-'))
    const srcDir = resolve(root, 'docs')
    await mkdir(srcDir)
    await writeFile(
      resolve(srcDir, 'index.crv'),
      ['---', 'title: Home', '---', '', '# Home', '', '[Missing](/missing)'].join('\n'),
    )

    await expect(
      build({ srcDir, base: '/carve-press/', themeConfig: { sidebar: {} } }, root),
    ).rejects.toThrow(/index\.crv: \/missing/)
  })

  it('emits a built-in 404 page outside the route table and search index', async () => {
    const { result, outDir } = await build()
    const html = await readFile(resolve(outDir, '404.html'), 'utf8')
    const search = JSON.parse(await readFile(resolve(outDir, 'assets/search-index.json'), 'utf8')) as {
      records: { route: string }[]
    }

    expect(html).toContain('<title>Page not found | Fixture</title>')
    expect(html).toContain('<p>The page you requested could not be found. <a href="/">Return home</a>.</p>')
    expect(result.routes).not.toContain('/404')
    expect(search.records.map((record) => record.route)).not.toContain('/404')
  })

  it('uses content 404.crv without adding it to normal outputs', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'cp-404-'))
    const srcDir = resolve(root, 'docs')
    await mkdir(srcDir)
    await writeFile(resolve(srcDir, 'index.crv'), ['---', 'title: Home', '---', '', '# Home'].join('\n'))
    await writeFile(
      resolve(srcDir, '404.crv'),
      ['---', 'title: Missing', '---', '', 'Custom missing page. [Home](/).'].join('\n'),
    )

    const { result, outDir } = await build({ srcDir, themeConfig: { sidebar: {} } }, root)
    const html = await readFile(resolve(outDir, '404.html'), 'utf8')

    expect(html).toContain('<title>Missing | Fixture</title>')
    expect(html).toContain('Custom missing page')
    expect(result.routes).toEqual(['/'])
    await expect(readFile(resolve(outDir, '404/index.html'), 'utf8')).rejects.toThrow()
  })

  it('renders prev/next from sidebar order', async () => {
    const { outDir } = await build({
      themeConfig: {
        sidebar: {
          '/': [
            {
              text: 'Intro',
              items: [
                { text: 'Home', link: '/' },
                { text: 'Start', link: '/start' },
                { text: 'Guide', link: '/guide/' },
              ],
            },
          ],
        },
      },
    })
    const html = await readFile(resolve(outDir, 'start/index.html'), 'utf8')
    expect(html).toContain('<nav class="page-nav" aria-label="Page navigation">')
    expect(html).toContain('<a class="page-nav__prev" rel="prev" href="/">')
    expect(html).toContain('<span class="page-nav__title">Home</span>')
    expect(html).toContain('<a class="page-nav__next" rel="next" href="/guide/">')
    expect(html).toContain('<span class="page-nav__title">Guide</span>')
  })

  it('applies supported per-page frontmatter controls', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'cp-page-meta-'))
    const srcDir = resolve(root, 'docs')
    await mkdir(srcDir)
    await writeFile(resolve(srcDir, 'index.crv'), ['---', 'title: Home', '---', '', '# Home'].join('\n'))
    await writeFile(
      resolve(srcDir, 'start.crv'),
      [
        '---',
        'title: Start',
        'description: Page description',
        'head:',
        '  - - meta',
        '    - name: robots',
        '      content: noindex',
        'image: /og.png',
        'outline: false',
        'aside: false',
        'sidebar: false',
        'prev: false',
        'next: { text: Custom, link: / }',
        'editLink: false',
        'lastUpdated: false',
        '---',
        '',
        '# Start',
        '## Hidden',
      ].join('\n'),
    )

    const { outDir } = await build(
      {
        srcDir,
        base: '/docs/',
        themeConfig: {
          editLink: { pattern: 'https://example.com/edit/:path', text: 'Edit' },
          lastUpdated: true,
          sidebar: { '/': [{ text: 'G', items: [{ text: 'Start', link: '/start' }] }] },
        },
      },
      root,
    )
    const html = await readFile(resolve(outDir, 'start/index.html'), 'utf8')

    expect(html).toContain('<meta name="description" content="Page description">')
    expect(html).toContain('<meta property="og:image" content="/docs/og.png">')
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">')
    expect(html).toContain('<meta name="robots" content="noindex">')
    expect(html).not.toContain('class="sidebar"')
    expect(html).not.toContain('class="outline"')
    expect(html).not.toContain('rel="prev"')
    expect(html).toContain('<a class="page-nav__next" rel="next" href="/docs/">')
    expect(html).not.toContain('class="edit-link"')
    expect(html).not.toContain('class="last-updated"')
  })

  it('fails on invalid per-page frontmatter values with page and key', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'cp-bad-page-meta-'))
    const srcDir = resolve(root, 'docs')
    await mkdir(srcDir)
    await writeFile(
      resolve(srcDir, 'index.crv'),
      ['---', 'title: Bad', 'outline: wide', '---', '', '# Bad'].join('\n'),
    )

    await expect(build({ srcDir, themeConfig: { sidebar: {} } }, root)).rejects.toMatchObject({
      srcPath: 'index.crv',
      message: 'frontmatter: invalid outline',
    })
  })

  it('generates sidebar groups from pages under a route prefix', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'cp-generated-sidebar-'))
    const srcDir = resolve(root, 'docs')
    await mkdir(resolve(srcDir, 'guide/nested'), { recursive: true })
    await writeFile(resolve(srcDir, 'index.crv'), ['---', 'title: Home', '---', '', '# Home'].join('\n'))
    await writeFile(resolve(srcDir, 'guide/index.crv'), ['---', 'title: Guide', '---', '', '# Guide'].join('\n'))
    await writeFile(resolve(srcDir, 'guide/a.crv'), ['---', 'title: A', 'order: 2', '---', '', '# A'].join('\n'))
    await writeFile(resolve(srcDir, 'guide/b.crv'), ['---', 'title: B', 'order: 1', '---', '', '# B'].join('\n'))
    await writeFile(resolve(srcDir, 'guide/hidden.crv'), ['---', 'title: Hidden', 'sidebar: false', '---', '', '# Hidden'].join('\n'))
    await writeFile(resolve(srcDir, 'guide/draft.crv'), ['---', 'title: Draft', 'draft: true', '---', '', '# Draft'].join('\n'))
    await writeFile(resolve(srcDir, 'guide/nested/index.crv'), ['# Nested'].join('\n'))

    const { outDir } = await build(
      {
        srcDir,
        themeConfig: {
          sidebar: { '/guide/': [{ text: 'Guide', generate: '/guide/' }] },
        },
      },
      root,
    )
    const html = await readFile(resolve(outDir, 'guide/index.html'), 'utf8')

    expect(html.indexOf('href="/guide/"')).toBeLessThan(html.indexOf('href="/guide/b"'))
    expect(html.indexOf('href="/guide/b"')).toBeLessThan(html.indexOf('href="/guide/a"'))
    expect(html).toContain('<a href="/guide/nested/">Nested</a>')
    expect(html).not.toContain('/guide/hidden')
    expect(html).not.toContain('/guide/draft')
  })

  it('renders locale-specific chrome and switches to matching translated routes', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'cp-locales-'))
    const srcDir = resolve(root, 'docs')
    await mkdir(resolve(srcDir, 'de'), { recursive: true })
    await writeFile(resolve(srcDir, 'index.crv'), ['---', 'title: Home', '---', '', '# Home'].join('\n'))
    await writeFile(resolve(srcDir, 'start.crv'), ['---', 'title: Start', '---', '', '# Start'].join('\n'))
    await writeFile(resolve(srcDir, 'de/index.crv'), ['---', 'title: Startseite', '---', '', '# Startseite'].join('\n'))
    await writeFile(
      resolve(srcDir, 'de/start.crv'),
      ['---', 'title: Start DE', '---', '', '# Start DE', '## Abschnitt', '', '```js', 'console.log(1)', '```'].join('\n'),
    )

    const { outDir } = await build(
      {
        srcDir,
        themeConfig: {
          sidebar: { '/': [{ text: 'G', items: [{ text: 'Start', link: '/start' }] }] },
        },
        locales: {
          '/': { lang: 'en', label: 'English' },
          '/de/': {
            lang: 'de-DE',
            label: 'Deutsch',
            title: 'Fixture DE',
            description: 'DE description',
            themeConfig: {
              labels: {
                search: 'Suche',
                previous: 'Zurueck',
                next: 'Weiter',
                lastUpdated: 'Aktualisiert',
                onThisPage: 'Auf dieser Seite',
                copy: 'Kopieren',
                copied: 'Kopiert',
                menu: 'Menue',
              },
            },
          },
        },
      },
      root,
    )
    const html = await readFile(resolve(outDir, 'de/start/index.html'), 'utf8')

    expect(html).toContain('<html lang="de-DE">')
    expect(html).toContain('<title>Start DE | Fixture DE</title>')
    expect(html).toContain('placeholder="Suche"')
    expect(html).toContain('aria-label="Auf dieser Seite"')
    expect(html).toContain('>Kopieren</button>')
    expect(html).toContain('"copied":"Kopiert"')
    expect(html).toContain('href="/start">English</a>')
    expect(html).toContain('href="/de/start" aria-current="true">Deutsch</a>')
  })

  it('uses the built-in page layout without sidebar or outline', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'cp-page-layout-'))
    const srcDir = resolve(root, 'docs')
    await mkdir(srcDir)
    await writeFile(
      resolve(srcDir, 'index.crv'),
      ['---', 'title: Plain', 'layout: page', '---', '', '# Plain'].join('\n'),
    )

    const { outDir } = await build({ srcDir, themeConfig: { sidebar: {} } }, root)
    const html = await readFile(resolve(outDir, 'index.html'), 'utf8')
    expect(html).toContain('<main class="page-layout content">')
    expect(html).not.toContain('class="sidebar"')
    expect(html).not.toContain('class="outline"')
  })

  it('lets user layouts replace built-ins', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'cp-custom-layout-'))
    const srcDir = resolve(root, 'docs')
    await mkdir(srcDir)
    await writeFile(resolve(srcDir, 'index.crv'), ['---', 'title: Custom', '---', '', '# Custom'].join('\n'))

    const { outDir } = await build(
      {
        srcDir,
        themeConfig: { sidebar: {} },
        layouts: {
          doc: ({ rendered }: { rendered: { html: string } }) => `<!doctype html><main>${rendered.html}</main>`,
        },
      },
      root,
    )
    const html = await readFile(resolve(outDir, 'index.html'), 'utf8')
    expect(html).toContain('<!doctype html><main><section id="Custom">')
    expect(html).not.toContain('class="site-header"')
  })

  it('fails on an unknown frontmatter layout and lists known layouts', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'cp-unknown-layout-'))
    const srcDir = resolve(root, 'docs')
    await mkdir(srcDir)
    await writeFile(resolve(srcDir, 'index.crv'), ['---', 'title: Custom', 'layout: missing', '---', '', '# Custom'].join('\n'))

    await expect(build({ srcDir, themeConfig: { sidebar: {} } }, root)).rejects.toThrow(
      /unknown layout "missing" \(known layouts: blog, doc, home, page\)/,
    )
  })

  it('omits unavailable prev/next links and omits the block for pages outside the sidebar', async () => {
    const { outDir } = await build({
      themeConfig: {
        sidebar: {
          '/': [
            {
              text: 'Intro',
              items: [
                { text: 'Home', link: '/' },
                { text: 'Start', link: '/start' },
                { text: 'Guide', link: '/guide/' },
              ],
            },
          ],
        },
      },
    })
    const first = await readFile(resolve(outDir, 'index.html'), 'utf8')
    const last = await readFile(resolve(outDir, 'guide/index.html'), 'utf8')
    const absent = await readFile(resolve(outDir, 'draft/index.html'), 'utf8')
    expect(first).not.toContain('rel="prev"')
    expect(first).toContain('rel="next"')
    expect(last).toContain('rel="prev"')
    expect(last).not.toContain('rel="next"')
    expect(absent).not.toContain('class="page-nav"')
  })

  it('follows sidebar order across group boundaries', async () => {
    const { outDir } = await build({
      themeConfig: {
        sidebar: {
          '/': [
            {
              text: 'Intro',
              items: [
                { text: 'Home', link: '/' },
                { text: 'Start', link: '/start' },
              ],
            },
            {
              text: 'Guide',
              items: [
                { text: 'Guide', link: '/guide/' },
                { text: 'Deep', link: '/guide/deep' },
              ],
            },
          ],
        },
      },
    })
    const html = await readFile(resolve(outDir, 'start/index.html'), 'utf8')
    expect(html).toContain('<a class="page-nav__next" rel="next" href="/guide/">')
    expect(html).toContain('<span class="page-nav__title">Guide</span>')
  })

  it('renders last updated from mtime when git has no entry for the file', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'cp-last-updated-'))
    const srcDir = resolve(root, 'docs')
    await mkdir(srcDir)
    await writeFile(resolve(srcDir, 'index.crv'), ['---', 'title: Fresh', '---', '', '# Fresh'].join('\n'))

    const { outDir } = await build(
      {
        srcDir,
        themeConfig: { lastUpdated: true, sidebar: {} },
      },
      root,
    )
    const html = await readFile(resolve(outDir, 'index.html'), 'utf8')
    expect(html).toMatch(/<time datetime="\d{4}-\d{2}-\d{2}T[^"]+Z">/)
  })

  it('fires build events in order', async () => {
    const seen: string[] = []
    await build({
      extensions: [
        {
          name: 'spy',
          setup(bus: { on: (e: string, h: () => void, owner?: string) => void }) {
            for (const event of [
              'buildStarted',
              'contentDiscovered',
              'rendererCreated',
              'pageRendered',
              'pageWritten',
              'buildCompleted',
            ]) {
              bus.on(event, () => void seen.push(event), 'spy')
            }
          },
        },
      ],
    })
    expect(seen[0]).toBe('buildStarted')
    expect(seen[1]).toBe('contentDiscovered')
    expect(seen[2]).toBe('rendererCreated')
    expect(seen.at(-1)).toBe('buildCompleted')
    expect(seen.filter((e) => e === 'pageRendered')).toHaveLength(5)
  })

  it('lets a contentDiscovered handler filter pages', async () => {
    const { result } = await build({
      extensions: [
        {
          name: 'drop-draft',
          setup(bus: { on: (e: string, h: (p: { pages: { route: string }[] }) => void) => void }) {
            bus.on('contentDiscovered', (p) => {
              p.pages = p.pages.filter((page) => page.route !== '/draft')
            })
          },
        },
      ],
    })
    expect(result.routes).not.toContain('/draft')
  })

  it('fails the build on a dead internal link', async () => {
    await expect(
      build({
        themeConfig: { sidebar: {} },
        srcDir: resolve(import.meta.dirname, 'fixtures/dead-link'),
      }),
    ).rejects.toThrow(/dead internal link/)
  })

  it('fails the build on a sidebar entry pointing nowhere', async () => {
    await expect(
      build({ themeConfig: { sidebar: { '/': [{ text: 'G', items: [{ text: 'X', link: '/gone' }] }] } } }),
    ).rejects.toThrow(/point at no route/)
  })

  it('does not swallow an error from an existing config candidate', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'cp-config-'))
    await writeFile(resolve(root, 'carve-press.config.ts'), 'throw new Error("config boom")\n')
    await writeFile(resolve(root, 'carve-press.config.js'), 'export default { title: "ok" }\n')
    await expect(loadConfig(root)).rejects.toThrow(/config boom/)
  })
})

describe('generated sidebars and frontmatter navigation overrides', () => {
  it('writes 404.html when the matching sidebar group is generated', async () => {
    const { outDir } = await build({
      themeConfig: { sidebar: { '/': [{ text: 'Docs', generate: '/' }] } },
    })
    const notFound = await readFile(resolve(outDir, '404.html'), 'utf8')
    // The generated group must be expanded by the time the 404 page renders,
    // or the layout meets a group with no items.
    expect(notFound).toContain('<nav class="sidebar"')
    expect(notFound).toContain('Start')
  })

  it('rejects a frontmatter prev or next pointing at a route that does not exist', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'cp-prevnext-'))
    await writeFile(
      resolve(root, 'index.crv'),
      '---\ntitle: Home\nnext:\n  text: Nowhere\n  link: /nowhere\n---\n\n# Home\n',
      'utf8',
    )
    const outDir = await mkdtemp(resolve(tmpdir(), 'cp-prevnext-out-'))

    await expect(
      buildSite({ root, config: { title: 'T', srcDir: root, outDir } }),
    ).rejects.toThrow(/dead frontmatter prev\/next link/)
  })
})
