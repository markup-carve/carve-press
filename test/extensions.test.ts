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
