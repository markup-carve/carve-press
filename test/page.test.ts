import { Profile } from '@markup-carve/carve'
import { describe, it, expect } from 'vitest'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import type { Page } from '../src/content/discover.js'
import { SourceError } from '../src/errors.js'
import { renderPage } from '../src/render/page.js'

const page = (source: string): Page => ({
  route: '/p',
  srcPath: resolve(import.meta.dirname, 'fixtures/site/start.crv'),
  relPath: 'start.crv',
  frontmatter: { title: 'Start' },
  source,
  bodyStartLine: 4,
})

const ctx = {
  extensions: [],
  outlineLevels: [2, 3] as [number, number],
  includeRoots: [resolve(import.meta.dirname, 'fixtures')],
  base: '/',
}

function idsFromHtml(html: string): string[] {
  return [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!)
}

describe('renderPage', () => {
  it('renders HTML, outline, and a search doc', () => {
    const r = renderPage(page('# T\n\n## Install\n\nrun it\n'), ctx)
    expect(r.html).toContain('<section id="T">')
    expect(r.outline).toEqual([{ level: 2, title: 'Install', slug: 'Install' }])
    expect(r.searchDoc.route).toBe('/p')
    expect(r.searchDoc.title).toBe('Start')
    expect(r.searchDoc.headings).toEqual(['Install'])
    expect(r.searchDoc.text).toContain('run it')
  })

  it('keeps rendered heading anchors aligned with outline slugs', () => {
    const r = renderPage(page('# T\n\n## Install\n\n## Getting Started\n\n### Next Steps\n'), {
      ...ctx,
      outlineLevels: [1, 3],
    })
    expect(idsFromHtml(r.html)).toEqual(r.outline.map((entry) => entry.slug))
  })

  it('excludes code blocks from the search text', () => {
    // Otherwise a search for a common keyword returns every fence on the site.
    const r = renderPage(page('# T\n\n```js\nconst needle = 1\n```\n\nprose\n'), ctx)
    expect(r.searchDoc.text).toContain('prose')
    expect(r.searchDoc.text).not.toContain('needle')
  })

  it('keeps inline code in the search text and in a derived title', () => {
    // Inline-code spans are the most-searched terms on an API reference, and a
    // heading containing one would otherwise lose the word from the title.
    const p = { ...page('# The `carve` CLI\n\nCall `carveToHtml` to render.\n'), frontmatter: {} }
    const r = renderPage(p, ctx)
    expect(r.searchDoc.title).toBe('The carve CLI')
    expect(r.searchDoc.text).toContain('carveToHtml')
  })

  it('still excludes fenced code blocks from the search text', () => {
    const r = renderPage(page('# T\n\n```js\nconst needle = 1\n```\n\nprose\n'), ctx)
    expect(r.searchDoc.text).toContain('prose')
    expect(r.searchDoc.text).not.toContain('needle')
  })

  it('falls back to the first H1 when frontmatter has no title', () => {
    const p = { ...page('# From Heading\n'), frontmatter: {} }
    expect(renderPage(p, ctx).searchDoc.title).toBe('From Heading')
  })

  it('throws a SourceError when a page has no title and no H1', () => {
    const p = { ...page('just text\n'), frontmatter: {} }
    expect(() => renderPage(p, ctx)).toThrow(/no frontmatter title and no H1/)
  })

  it('throws a SourceError when a carve profile rejects the page', () => {
    const profile = Profile.article().onDisallowed(Profile.ACTION_ERROR)

    expect(() =>
      renderPage(page('# T\n\n```=html\n<strong>raw</strong>\n```\n'), { ...ctx, profile }),
    ).toThrow(/profile:/)
  })

  it('enforces the profile max length that the engine checks before parsing', () => {
    const profile = Profile.article().onDisallowed(Profile.ACTION_ERROR).setMaxLength(16)

    expect(() => renderPage(page('# T\n\nplenty of prose here\n'), { ...ctx, profile })).toThrow(
      /maximum length of 16 bytes/,
    )
    expect(() => renderPage(page('# T\n'), { ...ctx, profile })).not.toThrow()
  })

  it('rejects the removed private include spelling at its source line', async () => {
    const dir = await mkdtemp(resolve(tmpdir(), 'cp-page-legacy-'))
    await writeFile(resolve(dir, 'legacy.crv'), 'LEGACY CONTENT\n')
    const p: Page = {
      ...page('# T\n\n%% @include: ./legacy.crv\n'),
      srcPath: resolve(dir, 'start.crv'),
    }

    expect(() => renderPage(p, { ...ctx, includeRoots: [dir] })).toThrow(
      expect.objectContaining({ line: 6, column: 1, message: expect.stringContaining('no longer expanded') }),
    )
  })

  it('expands standard nested includes with sections and heading shifts', async () => {
    const dir = await mkdtemp(resolve(tmpdir(), 'cp-page-standard-'))
    await mkdir(resolve(dir, 'chapters'))
    await writeFile(resolve(dir, 'start.crv'), '# T\n')
    await writeFile(
      resolve(dir, 'chapters/one.crv'),
      '# Part\n\n{{ ../shared.crv }}\n\n# Omitted\n',
    )
    await writeFile(resolve(dir, 'shared.crv'), 'Nested text.\n')
    const p: Page = {
      ...page('# T\n\n{{ chapters/one.crv #Part @shift:1 }}\n'),
      srcPath: resolve(dir, 'start.crv'),
    }

    const rendered = renderPage(p, { ...ctx, includeRoots: [dir] })
    expect(rendered.html).toContain('<h2>Part</h2>')
    expect(rendered.html).toContain('Nested text.')
    expect(rendered.html).not.toContain('Omitted')
    expect(rendered.includeFiles.map((file) => file.path)).toEqual([
      resolve(dir, 'chapters/one.crv'),
      resolve(dir, 'shared.crv'),
    ])
  })

  it('fails a standard include warning at the original line without leaking the root', async () => {
    const dir = await mkdtemp(resolve(tmpdir(), 'cp-page-warning-'))
    await writeFile(resolve(dir, 'start.crv'), '# T\n')
    const p: Page = {
      ...page('# T\n\n{{ missing.crv }}\n'),
      srcPath: resolve(dir, 'start.crv'),
    }

    try {
      renderPage(p, { ...ctx, includeRoots: [dir] })
      expect.unreachable('should reject an unresolved include')
    } catch (error) {
      const formatted = (error as SourceError).format()
      expect(formatted).toMatch(/start\.crv:6:1 include-unresolved/)
      expect(formatted).not.toContain(dir)
    }
  })

  it('refuses an include that traverses beyond the project root', async () => {
    const dir = await mkdtemp(resolve(tmpdir(), 'cp-page-containment-'))
    const site = resolve(dir, 'site')
    await mkdir(site)
    await writeFile(resolve(dir, 'secret.crv'), 'SECRET\n')
    await writeFile(resolve(site, 'start.crv'), '# T\n')
    const p: Page = {
      ...page('# T\n\n{{ ../secret.crv }}\n'),
      srcPath: resolve(site, 'start.crv'),
    }

    expect(() => renderPage(p, { ...ctx, includeRoots: [site] })).toThrow(/include-unresolved/)
  })
})

describe('renderPage base rewriting', () => {
  const based = { ...ctx, base: '/my-site/' }
  const hrefs = (source: string): string[] =>
    [...renderPage(page(source), based).html.matchAll(/(?:href|src)="([^"]*)"/g)]
      .map((m) => m[1]!)
      .filter((url) => url.endsWith('/g/x') || url.endsWith('/i.png'))

  it('prefixes a link in a paragraph', () => {
    expect(hrefs('Prose [A](/g/x)\n')).toEqual(['/my-site/g/x'])
  })

  it('prefixes a link in a bullet list item', () => {
    expect(hrefs('- Bullet [A](/g/x)\n')).toEqual(['/my-site/g/x'])
  })

  it('prefixes a link in an ordered list item', () => {
    expect(hrefs('1. Num [A](/g/x)\n')).toEqual(['/my-site/g/x'])
  })

  it('prefixes a link in a task list item', () => {
    expect(hrefs('- [ ] Task [A](/g/x)\n')).toEqual(['/my-site/g/x'])
  })

  it('prefixes a reference-style link in a list item', () => {
    expect(hrefs('- Ref [A][r]\n\n[r]: /g/x\n')).toEqual(['/my-site/g/x'])
  })

  it('prefixes a link in a nested list item', () => {
    expect(hrefs('- outer\n\n  - inner [A](/g/x)\n')).toEqual(['/my-site/g/x'])
  })

  it('prefixes an image in a list item', () => {
    expect(hrefs('- ![Alt](/i.png)\n')).toEqual(['/my-site/i.png'])
  })

  it('prefixes a link in a table cell', () => {
    expect(hrefs('| h |\n|---|\n| [A](/g/x) |\n')).toEqual(['/my-site/g/x'])
  })

  it('prefixes an image in a table cell', () => {
    expect(hrefs('| h |\n|---|\n| ![Alt](/i.png) |\n')).toEqual(['/my-site/i.png'])
  })

  it('prefixes a link in a footnote body', () => {
    expect(hrefs('T[^1]\n\n[^1]: Note [A](/g/x)\n')).toEqual(['/my-site/g/x'])
  })

  it('prefixes a link in a figure caption', () => {
    expect(hrefs('![Alt](/i.png)\n^ Cap [A](/g/x)\n')).toEqual(['/my-site/i.png', '/my-site/g/x'])
  })

  it('prefixes the image a figure places', () => {
    expect(hrefs('![Alt](/i.png)\n^ Cap\n')).toEqual(['/my-site/i.png'])
  })

  it('prefixes a link in a blockquote', () => {
    expect(hrefs('> Quote [A](/g/x)\n')).toEqual(['/my-site/g/x'])
  })

  it('prefixes a link in a container body', () => {
    expect(hrefs(':::note\nBody [A](/g/x)\n:::\n')).toEqual(['/my-site/g/x'])
  })

  it('prefixes a link in a heading', () => {
    expect(hrefs('## Head [A](/g/x)\n')).toEqual(['/my-site/g/x'])
  })

  it('prefixes links in a definition list term and description', () => {
    expect(hrefs(': Term [A](/g/x)\n\n  Desc [B](/g/x)\n')).toEqual([
      '/my-site/g/x',
      '/my-site/g/x',
    ])
  })

  it('leaves an external link and a relative link alone', () => {
    const html = renderPage(page('- [A](https://x.test/g/x) and [B](./g/x)\n'), based).html
    expect(html).toContain('href="https://x.test/g/x"')
    expect(html).toContain('href="./g/x"')
  })

  it('does not prefix twice when the link already carries the base', () => {
    expect(hrefs('- Bullet [A](/my-site/g/x)\n')).toEqual(['/my-site/g/x'])
  })
})
