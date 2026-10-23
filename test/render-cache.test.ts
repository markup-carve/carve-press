import { execFile } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { buildSite } from '../src/build.js'
import { resolveConfig, type UserConfig } from '../src/config.js'
import { globalFingerprint, PersistentRenderCache } from '../src/render-cache.js'

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

  it('starts cold from a corrupt cache file instead of failing', async () => {
    const root = await site()
    await mkdir(resolve(root, 'cache'), { recursive: true })
    await writeFile(resolve(root, 'cache/render-cache.json'), '{not json')
    expect((await build(root)).renderStats).toEqual({ rendered: 3, reused: 0 })
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
})
