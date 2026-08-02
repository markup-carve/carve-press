import { Profile } from '@markup-carve/carve'
import { describe, it, expect } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import type { Page } from '../src/content/discover.js'
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

  it('reports an include failure at the original file and line', () => {
    const p = page('# T\n\n%% @include: ./missing.crv\n')
    try {
      renderPage(p, ctx)
      throw new Error('expected renderPage to throw')
    } catch (error) {
      expect(error).toHaveProperty('format')
      expect((error as { format: () => string }).format()).toMatch(/start\.crv:6:1/)
    }
  })

  it('preserves the source location for include failures inside included files', async () => {
    const dir = await mkdtemp(resolve(tmpdir(), 'cp-page-'))
    await writeFile(resolve(dir, 'outer.crv'), 'intro\n%% @include: ./missing.crv\n')

    const p: Page = {
      ...page('# T\n\n%% @include: ./outer.crv\n'),
      srcPath: resolve(dir, 'start.crv'),
    }

    try {
      renderPage(p, { ...ctx, includeRoots: [dir] })
      expect.unreachable('should have thrown')
    } catch (error) {
      const formatted = (error as { format: () => string }).format()
      expect(formatted).toMatch(/outer\.crv:2:1 /)
      expect(formatted).not.toMatch(/start\.crv/)
    }
  })
})
