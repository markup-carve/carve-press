// test/outline.test.ts
import { describe, it, expect } from 'vitest'
import { parse } from '@markup-carve/carve'
import { outlineFromAst } from '../src/outline.js'

describe('outlineFromAst', () => {
  it('collects headings within the configured level range', () => {
    const ast = parse('# One\n\n## Two\n\n### Three\n\n#### Four\n')
    expect(outlineFromAst(ast, [2, 3])).toEqual([
      { level: 2, title: 'Two', slug: 'two' },
      { level: 3, title: 'Three', slug: 'three' },
    ])
  })

  it('ignores a hash inside a fenced code block', () => {
    const ast = parse('## Real\n\n```bash\n## not a heading\n```\n')
    expect(outlineFromAst(ast, [2, 3]).map((e) => e.title)).toEqual(['Real'])
  })

  it('finds headings nested inside containers', () => {
    const ast = parse('::: note\n## Inside\n:::\n')
    expect(outlineFromAst(ast, [2, 3]).map((e) => e.title)).toEqual(['Inside'])
  })

  it('flattens inline markup in the heading text', () => {
    const ast = parse('## A *bold* `code` word\n')
    expect(outlineFromAst(ast, [2, 3])[0]!.title).toBe('A bold code word')
  })

  it('deduplicates repeated slugs', () => {
    const ast = parse('## Install\n\n## Install\n')
    expect(outlineFromAst(ast, [2, 3]).map((e) => e.slug)).toEqual(['install', 'install-2'])
  })

  it('returns an empty outline for a page with no qualifying headings', () => {
    expect(outlineFromAst(parse('text\n'), [2, 3])).toEqual([])
  })
})
