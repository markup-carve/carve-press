import { describe, it, expect } from 'vitest'
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
}

describe('renderPage', () => {
  it('renders HTML, outline, and a search doc from one parse', () => {
    const r = renderPage(page('# T\n\n## Install\n\nrun it\n'), ctx)
    expect(r.html).toContain('<h1>T</h1>')
    expect(r.outline).toEqual([{ level: 2, title: 'Install', slug: 'Install' }])
    expect(r.searchDoc.route).toBe('/p')
    expect(r.searchDoc.title).toBe('Start')
    expect(r.searchDoc.headings).toEqual(['Install'])
    expect(r.searchDoc.text).toContain('run it')
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
})
