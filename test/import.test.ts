import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { buildSite } from '../src/build.js'
import { convertPage, formatImportReport, htmlContent, importSite } from '../src/import.js'

const execFileAsync = promisify(execFile)
const cli = resolve(import.meta.dirname, '../dist/cli.js')

async function legacy(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'cp-import-'))
  await mkdir(resolve(root, 'old/guide/img'), { recursive: true })
  await mkdir(resolve(root, 'old/.vitepress'), { recursive: true })
  await writeFile(resolve(root, 'old/index.md'), '---\ntitle: Home\n---\n\n# Home\n\nRead the [guide](/guide/start).\n')
  await writeFile(
    resolve(root, 'old/guide/start.md'),
    '# Start\n\nSee [home](../index.md) and **bold**.\n\n![logo](./img/logo.png)\n',
  )
  await writeFile(resolve(root, 'old/guide/img/logo.png'), 'PNG')
  await writeFile(resolve(root, 'old/.vitepress/config.mts'), 'export default {}\n')
  await writeFile(
    resolve(root, 'old/about.html'),
    '<html><head><title>About &amp; Us</title><script>track()</script></head>' +
      '<body><nav><a href="/x">Nav</a></nav><main><p>We <b>make</b> things.</p></main></body></html>',
  )
  return root
}

describe('htmlContent', () => {
  it('takes main over body and decodes the title', () => {
    expect(htmlContent('<title>A &amp; B</title><body><nav>n</nav><main><p>x</p></main></body>')).toEqual({
      body: '<p>x</p>',
      bodyLine: 1,
      title: 'A & B',
    })
    expect(htmlContent('<head>\n</head>\n<body>\n<main>\n<p>x</p></main>').bodyLine).toBe(4)
  })

  it('stops at the closing tag that matches the first main', () => {
    expect(
      htmlContent('<body><main><div><main>inner</main></div><p>a</p></main><nav>n</nav><main>b</main></body>').body,
    ).toBe('<div><main>inner</main></div><p>a</p>')
  })

  it('ignores a main spelled inside a comment or a script', () => {
    const html =
      '<head><script>const t = "<main>fake</main>"</script></head><body><!-- <main> -->' +
      '<main><p>real</p><script>"</main>"</script><p>more</p></main></body>'
    expect(htmlContent(html).body).toBe('<p>real</p><script>"</main>"</script><p>more</p>')
  })

  it('falls back to body, then to the whole input', () => {
    expect(htmlContent('<body><p>x</p></body>').body).toBe('<p>x</p>')
    expect(htmlContent('<p>x</p>').body).toBe('<p>x</p>')
  })
})

describe('convertPage', () => {
  it('flags a link that names a source file, at its line in the page', () => {
    const { diagnostics } = convertPage('# T\n\nSee [a](./a.md#x).\n', 'markdown')
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ code: 'link-to-source-file', line: 3, inOutput: true }),
    )
  })

  it('reports what the HTML importer dropped', () => {
    const { diagnostics } = convertPage('<p>x</p><script>y()</script>', 'html')
    expect(diagnostics).toContainEqual(
      expect.objectContaining({ code: 'element-dropped', fidelity: 'dropped' }),
    )
  })
})

describe('importSite', () => {
  it('converts pages, copies assets, skips hidden directories, and the result builds', async () => {
    const root = await legacy()
    const report = await importSite({ root, source: 'old', out: 'docs' })

    expect(report.pages.map((p) => [p.source, p.output, p.format])).toEqual([
      ['old/about.html', 'docs/about.crv', 'html'],
      ['old/guide/start.md', 'docs/guide/start.crv', 'markdown'],
      ['old/index.md', 'docs/index.crv', 'markdown'],
    ])
    expect(report.assets).toEqual(['public/guide/img/logo.png'])

    const about = await readFile(resolve(root, 'docs/about.crv'), 'utf8')
    expect(about).toBe('---yaml\ntitle: About & Us\n---\n\nWe *make* things.\n')
    expect(about).not.toContain('Nav')
    expect(await readFile(resolve(root, 'docs/index.crv'), 'utf8')).toContain('title: Home')

    const start = report.pages.find((p) => p.source === 'old/guide/start.md')!
    expect(start.diagnostics.map((d) => d.code)).toEqual(
      expect.arrayContaining(['link-to-source-file', 'relative-image']),
    )
    const lines = formatImportReport(report)
    expect(lines).toContain(
      'docs/guide/start.crv:3 link-to-source-file (degraded) - link ../index.md names a source file; CarvePress routes have no extension, so point it at the route',
    )
    expect(lines).toContain(
      'docs/guide/start.crv:5 relative-image (degraded) - image ./img/logo.png is relative; CarvePress publishes images from publicDir by root path, so write /guide/img/logo.png',
    )
    expect(lines.at(-1)).toMatch(/imported 3 page\(s\), copied 1 file\(s\), skipped 0/)

    // The one link CarvePress would reject is the source-file link it already flagged.
    await writeFile(
      resolve(root, 'docs/guide/start.crv'),
      (await readFile(resolve(root, 'docs/guide/start.crv'), 'utf8'))
        .replace('../index.md', '/')
        .replace('./img/logo.png', '/guide/img/logo.png'),
    )
    const built = await buildSite({
      root,
      config: { title: 'Migrated', srcDir: 'docs', outDir: 'dist', routeManifest: false },
    })
    expect(built.routes.sort()).toEqual(['/', '/about', '/guide/start'])
    expect(await readFile(resolve(root, 'dist/guide/img/logo.png'), 'utf8')).toBe('PNG')
    expect(await readFile(resolve(root, 'dist/guide/start/index.html'), 'utf8')).toContain(
      'src="/guide/img/logo.png"',
    )
  })

  it('imports pages that live under publicDir, and copies no asset onto itself', async () => {
    const root = await legacy()
    const report = await importSite({ root, source: 'old', out: 'docs', publicDir: 'old/guide' })
    expect(report.pages.map((p) => p.output)).toContain('docs/guide/start.crv')
    expect(report.skipped).toEqual([
      { path: 'old/guide/img/logo.png', reason: 'already in the public directory' },
    ])
  })

  it('never reads an excluded build output directory', async () => {
    const root = await legacy()
    await mkdir(resolve(root, 'old/dist'), { recursive: true })
    await writeFile(resolve(root, 'old/dist/page.html'), '<p>built</p>')
    await writeFile(resolve(root, 'old/dist/app.js'), 'built()')
    const report = await importSite({ root, source: 'old', out: 'docs', exclude: ['old/dist'] })
    expect(report.pages.map((p) => p.source)).not.toContain('old/dist/page.html')
    expect(report.assets).toEqual(['public/guide/img/logo.png'])
  })

  it('imports a docs folder in place', async () => {
    const root = await legacy()
    const report = await importSite({ root, source: 'old', out: 'old' })
    expect(report.pages.map((p) => p.output)).toEqual(['old/about.crv', 'old/guide/start.crv', 'old/index.crv'])
    expect(await readFile(resolve(root, 'old/index.crv'), 'utf8')).toContain('# Home')
    const again = await importSite({ root, source: 'old', out: 'old' })
    expect(again.pages).toEqual([])
    expect(again.skipped.map((s) => s.reason)).toContain('already Carve')
  })

  it('never overwrites without force', async () => {
    const root = await legacy()
    await mkdir(resolve(root, 'docs'), { recursive: true })
    await writeFile(resolve(root, 'docs/index.crv'), 'MINE\n')
    const report = await importSite({ root, source: 'old', out: 'docs' })
    expect(report.skipped).toEqual([{ path: 'old/index.md', reason: 'docs/index.crv exists' }])
    expect(await readFile(resolve(root, 'docs/index.crv'), 'utf8')).toBe('MINE\n')

    await importSite({ root, source: 'old', out: 'docs', force: true })
    expect(await readFile(resolve(root, 'docs/index.crv'), 'utf8')).toContain('# Home')
  })

  it('skips a page that is not UTF-8 instead of importing replacement characters', async () => {
    const root = await legacy()
    await writeFile(resolve(root, 'old/latin1.md'), Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]))
    const report = await importSite({ root, source: 'old', out: 'docs' })
    expect(report.skipped).toEqual([
      { path: 'old/latin1.md', reason: 'not valid UTF-8; re-encode it and import again' },
    ])
  })

  it('converts only one format with from', async () => {
    const root = await legacy()
    const report = await importSite({ root, source: 'old', out: 'docs', from: 'html' })
    expect(report.pages.map((p) => p.output)).toEqual(['docs/about.crv'])
    expect(report.skipped.map((s) => s.path)).toEqual(['old/guide/start.md', 'old/index.md'])
  })

  it('needs from for a single file with an unknown extension', async () => {
    const root = await legacy()
    await writeFile(resolve(root, 'page.txt'), '# T\n')
    await expect(importSite({ root, source: 'page.txt', out: 'docs' })).rejects.toThrow(/--from/)
    const report = await importSite({ root, source: 'page.txt', out: 'docs', from: 'markdown' })
    expect(report.pages[0]!.output).toBe('docs/page.crv')
  })

  it('refuses a single file whose extension contradicts from', async () => {
    const root = await legacy()
    await expect(
      importSite({ root, source: 'old/index.md', out: 'docs', from: 'html' }),
    ).rejects.toThrow(/is markdown, not html/)
  })
})

describe('carve-press import', () => {
  it('imports into srcDir and writes the JSON report on request', async () => {
    const root = await legacy()
    await writeFile(resolve(root, 'carve-press.config.js'), "export default { title: 'T', srcDir: 'content' }\n")
    const { stdout } = await execFileAsync(process.execPath, [cli, 'import', 'old', '--report', 'report.json', '--root', root])
    expect(stdout).toMatch(/imported 3 page\(s\)/)
    const report = JSON.parse(await readFile(resolve(root, 'report.json'), 'utf8'))
    expect(report.pages.map((p: { output: string }) => p.output)).toContain('content/index.crv')
  })
})
