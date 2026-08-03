import { describe, it, expect } from 'vitest'
import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { buildSite } from '../src/build.js'

const BASE = '/site/'

async function htmlFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await htmlFiles(path)))
    else if (entry.name.endsWith('.html')) out.push(path)
  }
  return out
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'cp-integrity-'))
  await mkdir(resolve(root, 'docs/de'), { recursive: true })
  await mkdir(resolve(root, 'docs/blog'), { recursive: true })
  await writeFile(resolve(root, 'docs/index.crv'), '---\ntitle: Home\n---\n# Home\n\n## Section\n\nProse.\n')
  await writeFile(resolve(root, 'docs/de/index.crv'), '---\ntitle: Start\n---\n# Start\n\nText.\n')
  await writeFile(
    resolve(root, 'docs/blog/post.crv'),
    '---\ntitle: Post\ndate: 2026-01-01\ntags: [news]\n---\n# Post\n\nBody.\n',
  )
  return root
}

/**
 * Link validation covers links an author wrote. This covers everything the
 * build itself emits - stylesheets, scripts, feeds advertised in the head,
 * search index, nav and sidebar entries - because that is where a generator
 * fails silently: a page that advertises a file the build never wrote is a 404
 * nobody sees until a reader clicks it.
 */
describe('output integrity', () => {
  it('emits no reference to a file the build did not write', async () => {
    const root = await fixture()
    const outDir = await mkdtemp(resolve(tmpdir(), 'cp-integrity-out-'))
    await buildSite({
      root,
      config: {
        title: 'Site',
        srcDir: 'docs',
        outDir,
        base: BASE,
        hostname: 'https://example.com',
        blog: { dir: 'blog', route: '/blog/' },
        feed: {},
        locales: {
          '/': { lang: 'en-US', label: 'English' },
          '/de/': { lang: 'de-DE', label: 'Deutsch' },
        },
        themeConfig: { sidebar: {}, nav: [{ text: 'Home', link: '/' }] },
      },
    })

    const missing: string[] = []
    for (const file of await htmlFiles(outDir)) {
      const raw = await readFile(file, 'utf8')
      // Code panes and templates hold escaped markup, which is text on the page
      // rather than a reference the browser will fetch.
      const html = raw.replace(/<pre[\s\S]*?<\/pre>/g, '').replace(/<template[\s\S]*?<\/template>/g, '')
      for (const [, ref] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
        if (!ref.startsWith(BASE)) continue
        const path = ref.slice(BASE.length).split('#')[0]!.split('?')[0]!
        if (path === '') continue
        const candidates = [
          resolve(outDir, path),
          resolve(outDir, path, 'index.html'),
          resolve(outDir, `${path}.html`),
        ]
        const found = await Promise.all(candidates.map(exists))
        if (!found.some(Boolean)) missing.push(`${file.slice(outDir.length)} -> ${ref}`)
      }
    }

    expect(missing).toEqual([])
  })
})
