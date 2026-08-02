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

  it('writes the shipped table overflow client script', async () => {
    const { outDir } = await build()
    const actual = await readFile(resolve(outDir, 'assets/table-scroll.js'), 'utf8')
    const expected = await readFile(resolve(import.meta.dirname, '../theme/table-scroll.js'), 'utf8')
    expect(actual).toBe(expected)
  })

  it('writes the shipped outline client script', async () => {
    const { outDir } = await build()
    const actual = await readFile(resolve(outDir, 'assets/outline.js'), 'utf8')
    const expected = await readFile(resolve(import.meta.dirname, '../theme/outline.js'), 'utf8')
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

  it('does not emit search assets or chrome when search is disabled', async () => {
    const { outDir } = await build({ search: false })
    await expect(readFile(resolve(outDir, 'assets/search-index.json'), 'utf8')).rejects.toThrow()
    await expect(readFile(resolve(outDir, 'assets/search.js'), 'utf8')).rejects.toThrow()
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

  it('resolves prev/next from the sidebar', async () => {
    const { outDir } = await build()
    const html = await readFile(resolve(outDir, 'start/index.html'), 'utf8')
    expect(html).toContain('rel="prev"')
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
