import { execFile } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { buildSite } from '../src/build.js'
import { resolveConfig, type UserConfig } from '../src/config.js'
import { globalFingerprint, PersistentRenderCache } from '../src/render-cache.js'
import { sitemap } from '../src/extensions/sitemap.js'

const execFileAsync = promisify(execFile)
const cli = resolve(import.meta.dirname, '../dist/cli.js')

const svg = (width: number) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="10"></svg>`

async function site(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'cp-cache-'))
  await mkdir(resolve(root, 'docs/snippets'), { recursive: true })
  await mkdir(resolve(root, 'public'), { recursive: true })
  await writeFile(resolve(root, 'docs/index.crv'), '# Home\n\n{{ snippets/part.crv }}\n')
  await writeFile(resolve(root, 'docs/about.crv'), '# About\n\n![logo](/logo.svg)\n')
  await writeFile(resolve(root, 'docs/other.crv'), '# Other\n')
  await writeFile(resolve(root, 'docs/snippets/part.crv'), 'Part one.\n')
  await writeFile(resolve(root, 'public/logo.svg'), svg(20))
  return root
}

const config: UserConfig = { title: 'T', srcDir: 'docs', outDir: 'dist', srcExclude: ['snippets/**'], routeManifest: false }

async function build(root: string, global = globalFingerprint(root, resolveConfig(config, root))) {
  const file = resolve(root, 'cache/render-cache.json')
  const renderCache = await PersistentRenderCache.load({ file, root, global })
  const result = await buildSite({ root, config, renderCache })
  await renderCache.save()
  return result
}

const page = (root: string, path: string) => readFile(resolve(root, 'dist', path), 'utf8')

describe('PersistentRenderCache', () => {
  it('reuses every render on an unchanged rebuild and writes the same HTML', async () => {
    const root = await site()
    expect((await build(root)).renderStats).toEqual({ rendered: 3, reused: 0 })
    const first = await Promise.all(['index.html', 'about/index.html'].map((p) => page(root, p)))
    expect((await build(root)).renderStats).toEqual({ rendered: 0, reused: 3 })
    const second = await Promise.all(['index.html', 'about/index.html'].map((p) => page(root, p)))
    expect(second).toEqual(first)
    expect(first[0]).toContain('Part one.')
  })

  it('re-renders a page whose source changed, and only that page', async () => {
    const root = await site()
    await build(root)
    await writeFile(resolve(root, 'docs/other.crv'), '# Other\n\nNew text.\n')
    expect((await build(root)).renderStats).toEqual({ rendered: 1, reused: 2 })
    expect(await page(root, 'other/index.html')).toContain('New text.')
  })

  it('re-renders a page whose include changed', async () => {
    const root = await site()
    await build(root)
    await writeFile(resolve(root, 'docs/snippets/part.crv'), 'Part two.\n')
    expect((await build(root)).renderStats).toEqual({ rendered: 1, reused: 2 })
    expect(await page(root, 'index.html')).toContain('Part two.')
  })

  it('re-renders a page whose image changed size', async () => {
    const root = await site()
    await build(root)
    expect(await page(root, 'about/index.html')).toContain('width="20"')
    await writeFile(resolve(root, 'public/logo.svg'), svg(40))
    expect((await build(root)).renderStats).toEqual({ rendered: 1, reused: 2 })
    expect(await page(root, 'about/index.html')).toContain('width="40"')
  })

  it('renders everything when the global fingerprint moves', async () => {
    const root = await site()
    await build(root, 'one')
    expect((await build(root, 'two')).renderStats).toEqual({ rendered: 3, reused: 0 })
  })

  it('changes the global fingerprint with the config file and with extension code', async () => {
    const root = await site()
    const base = globalFingerprint(root, resolveConfig(config, root))
    await writeFile(resolve(root, 'carve-press.config.js'), 'export default {}\n')
    expect(globalFingerprint(root, resolveConfig(config, root))).not.toBe(base)
    const ext = (body: string) =>
      resolveConfig({ ...config, carve: { extensions: [{ name: 'x', afterParse: new Function('d', body) as never }] } }, root)
    expect(globalFingerprint(root, ext('return d'))).not.toBe(globalFingerprint(root, ext('return d /* v2 */')))
  })

  it('is bypassed for render extensions whose imported code it cannot see', async () => {
    const root = await site()
    const cached = async (over: Partial<UserConfig>) => {
      const renderCache = await PersistentRenderCache.load({ file: resolve(root, 'c.json'), root, global: 'g' })
      return buildSite({ root, config: { ...config, ...over }, renderCache })
    }
    expect((await cached({ extensions: [sitemap({ hostname: 'https://x.test' })] })).renderCacheBlocked).toBeUndefined()
    expect((await cached({ carve: { extensions: [{ name: 'x' }] } })).renderCacheBlocked).toMatch(/carve\.extensions/)
    let setups = 0
    const stackChanger = {
      name: 'stack',
      setup(bus: { on: (event: string, fn: () => void) => void }) {
        setups += 1
        bus.on('rendererCreated', () => {})
      },
    }
    const blocked = await cached({ extensions: [stackChanger as never] })
    expect(blocked.renderCacheBlocked).toMatch(/changes the render stack/)
    expect(blocked.renderStats).toEqual({ rendered: 3, reused: 0 })
    expect(setups).toBe(1)
  })

  it('re-renders a page a contentDiscovered hook changed', async () => {
    const root = await site()
    const rewrite = (text: string) => ({
      name: 'rewrite',
      setup(bus: { on: (event: string, fn: (p: { pages: { source: string }[] }) => void) => void }) {
        bus.on('contentDiscovered', ({ pages }) => {
          for (const page of pages) page.source = page.source.replace('# Other', `# Other\n\n${text}`)
        })
      },
    })
    const run = async (text: string) => {
      const renderCache = await PersistentRenderCache.load({ file: resolve(root, 'c.json'), root, global: 'g' })
      const result = await buildSite({ root, config: { ...config, extensions: [rewrite(text) as never] }, renderCache })
      await renderCache.save()
      return result
    }
    await run('First.')
    expect((await run('Second.')).renderStats).toEqual({ rendered: 1, reused: 2 })
    expect(await page(root, 'other/index.html')).toContain('Second.')
  })

  it('reports a cache it cannot write instead of throwing', async () => {
    const root = await site()
    await writeFile(resolve(root, 'blocker'), 'a file, not a directory')
    const renderCache = await PersistentRenderCache.load({ file: resolve(root, 'blocker/cache.json'), root, global: 'g' })
    await buildSite({ root, config, renderCache })
    expect(await renderCache.save()).toBeInstanceOf(Error)
  })

  it('changes the global fingerprint when a custom Shiki grammar object changes', () => {
    const grammar = (match: string) =>
      ({ name: 'mylang', scopeName: 'source.mylang', patterns: [{ match, name: 'keyword' }], repository: {} }) as never
    const withLang = (match: string) => resolveConfig({ ...config, shiki: { langs: [grammar(match)] } }, '/site')
    expect(globalFingerprint('/site', withLang('foo'))).not.toBe(globalFingerprint('/site', withLang('bar')))
  })

  it('starts cold from a corrupt cache file instead of failing', async () => {
    const root = await site()
    await mkdir(resolve(root, 'cache'), { recursive: true })
    const file = resolve(root, 'cache/render-cache.json')
    const global = globalFingerprint(root, resolveConfig(config, root))
    for (const body of [
      '{not json',
      'null',
      JSON.stringify({ format: 1, global }),
      JSON.stringify({ format: 1, global, entries: { 'docs/index.crv': { route: '/' } } }),
    ]) {
      await writeFile(file, body)
      expect((await build(root)).renderStats).toEqual({ rendered: 3, reused: 0 })
    }
  })

  it('drops a deleted page from the saved cache', async () => {
    const root = await site()
    await build(root)
    await unlink(resolve(root, 'docs/other.crv'))
    await build(root)
    const stored = JSON.parse(await readFile(resolve(root, 'cache/render-cache.json'), 'utf8'))
    expect(Object.keys(stored.entries).sort()).toEqual(['docs/about.crv', 'docs/index.crv'])
  })
})

describe('carve-press build cache', () => {
  const run = (root: string, ...args: string[]) =>
    execFileAsync(process.execPath, [cli, 'build', '--root', root, ...args]).then((out) => out.stdout)

  it('reuses renders across runs, and --no-cache neither reads nor writes the cache', async () => {
    const root = await site()
    await writeFile(
      resolve(root, 'carve-press.config.js'),
      `export default ${JSON.stringify(config)}\n`,
    )
    const cacheFile = resolve(root, 'node_modules/.cache/carve-press/render-cache.json')

    expect(await run(root, '--no-cache')).not.toContain('from cache')
    await expect(access(cacheFile)).rejects.toThrow()

    expect(await run(root)).toContain('(3 rendered, 0 from cache)')
    expect(await run(root)).toContain('(0 rendered, 3 from cache)')
    expect(await run(root, '--no-cache')).not.toContain('from cache')
  })

  it('renders everything and says why when config adds render extensions', async () => {
    const root = await site()
    await writeFile(
      resolve(root, 'carve-press.config.js'),
      `export default { ...${JSON.stringify(config)}, carve: { extensions: [{ name: 'mine' }] } }\n`,
    )
    const out = await run(root)
    expect(out).toContain('build cache off: carve.extensions adds render extensions')
    expect(out).not.toContain('from cache')
  })
})
