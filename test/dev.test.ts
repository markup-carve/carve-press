import { describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { createDevRebuilder } from '../src/dev.js'

const page = (title: string, body = `# ${title}`): string =>
  ['---', `title: ${title}`, '---', '', body, ''].join('\n')

const config = (body: string): string => `export default ${body}\n`

async function pauseForConfigCachebuster(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 50))
}

describe('createDevRebuilder', () => {
  it('returns failed rebuilds without throwing and recovers on the next success', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'cp-dev-'))
    await mkdir(resolve(root, 'docs'))
    await writeFile(resolve(root, 'carve-press.config.js'), "export default { title: 'Docs' }\n")
    await writeFile(resolve(root, 'docs/index.crv'), ['---', 'title: Home', '---', '', '# Home'].join('\n'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const success = vi.fn()
    const rebuilder = createDevRebuilder(root, success)

    await expect(rebuilder.rebuild()).resolves.toMatchObject({ ok: true })
    await expect(readFile(resolve(root, 'dist/index.html'), 'utf8')).resolves.toContain('<h1>Home')

    await writeFile(
      resolve(root, 'docs/index.crv'),
      ['---', 'title: Home', '---', '', '# Home', '', '[Missing](/missing)'].join('\n'),
    )
    await expect(rebuilder.rebuild()).resolves.toMatchObject({ ok: false })
    expect(error).toHaveBeenCalledWith(expect.stringContaining('/missing'))

    await writeFile(resolve(root, 'docs/start.crv'), ['---', 'title: Start', '---', '', '# Start'].join('\n'))
    await writeFile(
      resolve(root, 'docs/index.crv'),
      ['---', 'title: Home', '---', '', '# Home', '', '[Start](/start)'].join('\n'),
    )
    await expect(rebuilder.rebuild()).resolves.toMatchObject({ ok: true })
    await expect(readFile(resolve(root, 'dist/start/index.html'), 'utf8')).resolves.toContain('<h1>Start')
    expect(success).toHaveBeenCalledTimes(2)
    error.mockRestore()
  })

  it('re-renders one changed page and reuses the rest when incremental dev builds are enabled', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'cp-dev-inc-'))
    await mkdir(resolve(root, 'docs'))
    await writeFile(
      resolve(root, 'carve-press.config.js'),
      config("{ title: 'Docs', routeManifest: false, dev: { incremental: true } }"),
    )
    await writeFile(resolve(root, 'docs/index.crv'), page('Home'))
    await writeFile(resolve(root, 'docs/start.crv'), page('Start'))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const rebuilder = createDevRebuilder(root)

    const first = await rebuilder.rebuild()
    expect(first).toMatchObject({
      ok: true,
      renderStats: { rendered: 2, reused: 0 },
    })

    await writeFile(resolve(root, 'docs/start.crv'), page('Start', '# Start\n\nChanged.'))
    await expect(rebuilder.rebuild()).resolves.toMatchObject({
      ok: true,
      renderStats: { rendered: 1, reused: 1 },
    })
    expect(first.renderStats).toEqual({ rendered: 2, reused: 0 })
    expect(log).toHaveBeenLastCalledWith(expect.stringContaining('(1 rendered, 1 reused)'))
    log.mockRestore()
  })

  it('re-renders a page when an included file changes', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'cp-dev-include-'))
    await mkdir(resolve(root, 'docs/snippets'), { recursive: true })
    await writeFile(
      resolve(root, 'carve-press.config.js'),
      config("{ title: 'Docs', routeManifest: false, dev: { incremental: true } }"),
    )
    await writeFile(resolve(root, 'docs/index.crv'), page('Home', '# Home\n\n%% @include: ./snippets/shared.txt'))
    await writeFile(resolve(root, 'docs/start.crv'), page('Start'))
    await writeFile(resolve(root, 'docs/snippets/shared.txt'), 'Included text.\n')
    const rebuilder = createDevRebuilder(root)

    await expect(rebuilder.rebuild()).resolves.toMatchObject({
      ok: true,
      renderStats: { rendered: 2, reused: 0 },
    })

    await writeFile(resolve(root, 'docs/snippets/shared.txt'), 'Changed included text.\n')
    await expect(rebuilder.rebuild()).resolves.toMatchObject({
      ok: true,
      renderStats: { rendered: 1, reused: 1 },
    })
    await expect(readFile(resolve(root, 'dist/index.html'), 'utf8')).resolves.toContain(
      'Changed included text.',
    )
  })

  it('drops the incremental cache when config, theme CSS, or extra CSS changes', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'cp-dev-global-'))
    await mkdir(resolve(root, 'docs'))
    await mkdir(resolve(root, 'theme'))
    await writeFile(resolve(root, 'docs/index.crv'), page('Home'))
    await writeFile(resolve(root, 'docs/start.crv'), page('Start'))
    await writeFile(resolve(root, 'theme/site.css'), 'body { color: black; }\n')
    await writeFile(resolve(root, 'theme/extra.css'), 'a { color: blue; }\n')
    await writeFile(
      resolve(root, 'carve-press.config.js'),
      config(
        "{ title: 'Docs', routeManifest: false, theme: { css: 'theme/site.css', extraCss: ['theme/extra.css'] }, dev: { incremental: true } }",
      ),
    )
    const rebuilder = createDevRebuilder(root)

    await expect(rebuilder.rebuild()).resolves.toMatchObject({
      ok: true,
      renderStats: { rendered: 2, reused: 0 },
    })
    await expect(rebuilder.rebuild()).resolves.toMatchObject({
      ok: true,
      renderStats: { rendered: 0, reused: 2 },
    })

    await pauseForConfigCachebuster()
    await writeFile(
      resolve(root, 'carve-press.config.js'),
      config(
        "{ title: 'Changed Docs', routeManifest: false, theme: { css: 'theme/site.css', extraCss: ['theme/extra.css'] }, dev: { incremental: true } }",
      ),
    )
    await pauseForConfigCachebuster()
    await expect(rebuilder.rebuild()).resolves.toMatchObject({
      ok: true,
      renderStats: { rendered: 2, reused: 0 },
    })

    await writeFile(resolve(root, 'theme/site.css'), 'body { color: green; }\n')
    await expect(rebuilder.rebuild()).resolves.toMatchObject({
      ok: true,
      renderStats: { rendered: 2, reused: 0 },
    })

    await writeFile(resolve(root, 'theme/extra.css'), 'a { color: purple; }\n')
    await expect(rebuilder.rebuild()).resolves.toMatchObject({
      ok: true,
      renderStats: { rendered: 2, reused: 0 },
    })
  })

  it('renders every page on every rebuild when incremental dev builds are absent or false', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'cp-dev-full-'))
    await mkdir(resolve(root, 'docs'))
    await writeFile(resolve(root, 'docs/index.crv'), page('Home'))
    await writeFile(resolve(root, 'docs/start.crv'), page('Start'))
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    await writeFile(resolve(root, 'carve-press.config.js'), config("{ title: 'Docs', routeManifest: false }"))
    const absent = createDevRebuilder(root)
    await expect(absent.rebuild()).resolves.toMatchObject({
      ok: true,
      renderStats: { rendered: 2, reused: 0 },
    })
    await expect(absent.rebuild()).resolves.toMatchObject({
      ok: true,
      renderStats: { rendered: 2, reused: 0 },
    })
    expect(log).toHaveBeenLastCalledWith(expect.not.stringContaining('rendered,'))

    await pauseForConfigCachebuster()
    await writeFile(
      resolve(root, 'carve-press.config.js'),
      config("{ title: 'Docs', routeManifest: false, dev: { incremental: false } }"),
    )
    await pauseForConfigCachebuster()
    const disabled = createDevRebuilder(root)
    await expect(disabled.rebuild()).resolves.toMatchObject({
      ok: true,
      renderStats: { rendered: 2, reused: 0 },
    })
    await expect(disabled.rebuild()).resolves.toMatchObject({
      ok: true,
      renderStats: { rendered: 2, reused: 0 },
    })
    expect(log).toHaveBeenLastCalledWith(expect.not.stringContaining('rendered,'))
    log.mockRestore()
  })

  it('writes identical HTML whether pages are rendered or reused', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'cp-dev-identical-'))
    await mkdir(resolve(root, 'docs'))
    await writeFile(resolve(root, 'docs/index.crv'), page('Home', '# Home\n\n[Start](/start)'))
    await writeFile(resolve(root, 'docs/start.crv'), page('Start', '# Start\n\n[Home](/)'))
    await writeFile(
      resolve(root, 'carve-press.config.js'),
      config("{ title: 'Docs', routeManifest: false, outDir: 'dist-inc', dev: { incremental: true } }"),
    )
    const rebuilder = createDevRebuilder(root)

    await expect(rebuilder.rebuild()).resolves.toMatchObject({
      ok: true,
      renderStats: { rendered: 2, reused: 0 },
    })
    await expect(rebuilder.rebuild()).resolves.toMatchObject({
      ok: true,
      renderStats: { rendered: 0, reused: 2 },
    })
    const reusedHome = await readFile(resolve(root, 'dist-inc/index.html'), 'utf8')
    const reusedStart = await readFile(resolve(root, 'dist-inc/start/index.html'), 'utf8')

    await pauseForConfigCachebuster()
    await writeFile(
      resolve(root, 'carve-press.config.js'),
      config("{ title: 'Docs', routeManifest: false, outDir: 'dist-full', dev: { incremental: false } }"),
    )
    await pauseForConfigCachebuster()
    await expect(rebuilder.rebuild()).resolves.toMatchObject({
      ok: true,
      renderStats: { rendered: 2, reused: 0 },
    })

    await expect(readFile(resolve(root, 'dist-full/index.html'), 'utf8')).resolves.toBe(reusedHome)
    await expect(readFile(resolve(root, 'dist-full/start/index.html'), 'utf8')).resolves.toBe(reusedStart)
  })
})

describe('dev rebuilds and the route manifest', () => {
  it('checks the manifest but never rewrites it', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'cp-dev-manifest-'))
    await mkdir(resolve(root, 'docs'))
    await writeFile(resolve(root, 'carve-press.config.js'), config("{ title: 'Docs', srcDir: 'docs' }"))
    await writeFile(resolve(root, 'docs/index.crv'), page('Home'))
    await writeFile(resolve(root, 'docs/kept.crv'), page('Kept'))
    // Compact and newline-free on purpose: a rewrite would normalize the
    // formatting, so an identical-content manifest still proves nothing was
    // written.
    const manifest = '["/","/kept"]'
    await writeFile(resolve(root, 'routes.json'), manifest)

    const first = await createDevRebuilder(root).rebuild()
    expect(first.ok).toBe(true)

    // The manifest sits next to the config, and the config's directory is what
    // the file watcher can see. Rewriting it on every save made each rebuild
    // trigger the next one, forever.
    await expect(readFile(resolve(root, 'routes.json'), 'utf8')).resolves.toBe(manifest)

    // Still checked: a route that vanished without a redirect fails the rebuild.
    await writeFile(resolve(root, 'routes.json'), '[\n  "/",\n  "/kept",\n  "/gone"\n]\n')
    const second = await createDevRebuilder(root).rebuild()
    expect(second.ok).toBe(false)
    expect(String(second.error)).toContain('disappeared without a redirect')
  })
})
