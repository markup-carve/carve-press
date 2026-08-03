import { describe, it, expect } from 'vitest'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { buildSite } from '../src/build.js'

const COUNTER = "export default (element, props) => { element.textContent = String(props.start ?? 0) }\n"

async function site(files: Record<string, string>) {
  const root = await mkdtemp(resolve(tmpdir(), 'cp-islands-'))
  await mkdir(resolve(root, 'docs'), { recursive: true })
  for (const [name, source] of Object.entries(files)) {
    const path = resolve(root, name)
    await mkdir(resolve(path, '..'), { recursive: true })
    await writeFile(path, source)
  }
  return root
}

async function build(root: string, config: object = {}) {
  const outDir = await mkdtemp(resolve(tmpdir(), 'cp-islands-out-'))
  await buildSite({
    root,
    config: { title: 'Site', srcDir: 'docs', outDir, themeConfig: { sidebar: {} }, ...config },
  })
  return outDir
}

const island = [
  '---',
  'title: Home',
  '---',
  '',
  '# Home',
  '',
  '{name="counter" props="{\\"start\\": 3}"}',
  '::: island',
  'Loading the counter.',
  ':::',
  '',
].join('\n')

describe('islands', () => {
  it('renders a mount point that keeps its authored content as the fallback', async () => {
    const root = await site({ 'docs/index.crv': island, 'islands/counter.js': COUNTER })

    const outDir = await build(root, { islands: { counter: 'islands/counter.js' } })
    const html = await readFile(resolve(outDir, 'index.html'), 'utf8')

    expect(html).toContain('data-island="counter"')
    expect(html).toContain('data-island-hydrate="load"')
    expect(html).toContain('data-island-props="{&quot;start&quot;: 3}"')
    // With no JavaScript the reader still sees what the author wrote.
    expect(html).toContain('Loading the counter.')
  })

  it('ships the site module and the loader, and registers the module URL', async () => {
    const root = await site({ 'docs/index.crv': island, 'islands/counter.js': COUNTER })

    const outDir = await build(root, { islands: { counter: 'islands/counter.js' } })
    const names = await readdir(resolve(outDir, 'assets/islands'))
    const html = await readFile(resolve(outDir, 'index.html'), 'utf8')

    expect(names.some((name) => /^counter\.[0-9a-f]{8}\.js$/.test(name))).toBe(true)
    expect(html).toContain('window.__carvePressIslands=')
    expect(html).toMatch(/assets\/islands\.[0-9a-f]{8}\.js/)
    // The module the site wrote, copied rather than bundled or transformed.
    const emitted = await readFile(resolve(outDir, 'assets/islands', names[0]!), 'utf8')
    expect(emitted).toBe(COUNTER)
  })

  it('adds nothing to a page or a build without islands', async () => {
    const plain = '---\ntitle: Home\n---\n# Home\n'
    const withConfig = await site({ 'docs/index.crv': plain, 'islands/counter.js': COUNTER })
    const without = await site({ 'docs/index.crv': plain })

    const configured = await build(withConfig, { islands: { counter: 'islands/counter.js' } })
    const bare = await build(without)

    // Configured but unused: the page pays nothing.
    const configuredHtml = await readFile(resolve(configured, 'index.html'), 'utf8')
    expect(configuredHtml).not.toContain('__carvePressIslands')
    expect(configuredHtml).not.toContain('islands.js')

    const bareHtml = await readFile(resolve(bare, 'index.html'), 'utf8')
    expect(bareHtml).not.toContain('island')
    await expect(readdir(resolve(bare, 'assets/islands'))).rejects.toThrow()
  })

  it('fails the build for an unconfigured island, bad props, or a missing module', async () => {
    const unconfigured = await site({ 'docs/index.crv': island })
    await expect(build(unconfigured)).rejects.toThrow(/island "counter" is not configured/)

    const badProps = await site({
      'docs/index.crv': island.replace('props="{\\"start\\": 3}"', 'props="{oops}"'),
      'islands/counter.js': COUNTER,
    })
    await expect(build(badProps, { islands: { counter: 'islands/counter.js' } })).rejects.toThrow(
      /invalid props JSON/,
    )

    const missingModule = await site({ 'docs/index.crv': island })
    await expect(
      build(missingModule, { islands: { counter: 'islands/nope.js' } }),
    ).rejects.toThrow(/cannot be read/)
  })
})
