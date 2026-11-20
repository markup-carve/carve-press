import { describe, it, expect } from 'vitest'
import { resolveConfig } from '../src/config.js'
import { buildExtensionStack } from '../src/render/extensions.js'

const shiki = { langs: ['js'], themes: { light: 'github-light', dark: 'github-dark' } }

describe('buildExtensionStack', () => {
  it('includes the built-in extensions in a stable order', async () => {
    const stack = await buildExtensionStack(resolveConfig({ title: 'x' }), shiki)
    const names = stack.map((e) => e.name)
    expect(names.slice(0, 6)).toEqual([
      'shiki',
      'carve-press-table-scroll',
      'carve-press-compare',
      'carve-press-playground',
      'code-group',
      'heading-permalinks',
    ])
    expect(names).toContain('tabs')
    expect(names).toContain('details')
    expect(names).toContain('math-block')
  })

  it('resolves minimal and full presets', async () => {
    const minimal = await buildExtensionStack(resolveConfig({ title: 'x', carve: { preset: 'minimal' } }), shiki)
    const full = await buildExtensionStack(resolveConfig({ title: 'x', carve: { preset: 'full' } }), shiki)
    expect(minimal.map((e) => e.name)).not.toContain('tabs')
    // Never in a preset: it injects a table of contents into every document,
    // duplicating the theme's outline column. `::: toc` asks for one per page.
    expect(full.map((e) => e.name)).not.toContain('table-of-contents')
    expect(full.map((e) => e.name)).toEqual(expect.arrayContaining([
      'tabs',
      'details',
      'math-block',
      'external-links',
      'toc',
      'wikilinks',
      'headingNumbers',
      'glossary',
      'index',
      'citations',
      'codeCallouts',
      'color',
      'spoiler',
      'list-table',
      'img-fence',
      'default-attributes',
    ]))
  })

  it('appends user extensions last so they can override built-ins', async () => {
    const mine = { name: 'mine' }
    const stack = await buildExtensionStack(
      resolveConfig({ title: 'x', carve: { extensions: [mine] } }),
      shiki,
    )
    expect(stack.at(-1)?.name).toBe('mine')
  })
})

describe('render stack output', () => {
  it('renders ::: toc with its own renderer under the docs preset', async () => {
    const { renderPage } = await import('../src/render/page.js')
    const stack = await buildExtensionStack(resolveConfig({ title: 'x' }), shiki)
    const page = { route: '/p', srcPath: '/tmp/p.crv', relPath: 'p.crv', frontmatter: { title: 'T' }, source: '# T\n\n## A\n\n::: toc\n:::\n', bodyStartLine: 1 }
    const rendered = renderPage(page as never, { extensions: stack, outlineLevels: [2, 3], includeRoots: [], base: '/' })
    expect(rendered.html).toContain('<nav class="toc" aria-label="Table of contents">')
  })

  it('reads the outline from what the page shows, without the permalink anchor', async () => {
    const { renderPage } = await import('../src/render/page.js')
    const stack = await buildExtensionStack(resolveConfig({ title: 'x', carve: { preset: 'full' } }), shiki)
    const page = { route: '/p', srcPath: '/tmp/p.crv', relPath: 'p.crv', frontmatter: { title: 'T' }, source: '# T\n\n## Section\n', bodyStartLine: 1 }
    const rendered = renderPage(page as never, { extensions: stack, outlineLevels: [2, 3], includeRoots: [], base: '/' })
    expect(rendered.outline).toEqual([{ level: 2, title: '1 Section', slug: 'Section' }])
    expect(rendered.searchDoc.text).not.toContain('¶')
  })
})
