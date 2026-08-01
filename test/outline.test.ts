// test/outline.test.ts
import { describe, it, expect } from 'vitest'
import { carveToHtml, parse } from '@markup-carve/carve'
import { outlineFromAst } from '../src/outline.js'

function headingIdsFromHtml(html: string): string[] {
  return [...html.matchAll(/\sid="([^"]+)"/g)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  )
}

describe('outlineFromAst', () => {
  it('collects headings within the configured level range', () => {
    const ast = parse('# One\n\n## Two\n\n### Three\n\n#### Four\n')
    expect(outlineFromAst(ast, [2, 3])).toEqual([
      { level: 2, title: 'Two', slug: 'Two' },
      { level: 3, title: 'Three', slug: 'Three' },
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

  it('uses resolved ids for awkward heading sources', () => {
    const ast = parse('## Getting Started\n\n## 123\n\n{#custom}\n## Title\n\n## Install\n\n## Install\n')
    expect(outlineFromAst(ast, [2, 3]).map((e) => e.slug)).toEqual([
      'Getting-Started',
      's-123',
      'custom',
      'Install',
      'Install-2',
    ])
  })

  it('matches heading ids emitted by the renderer', () => {
    const source = [
      '## Getting Started',
      '',
      '## 123',
      '',
      '{#custom}',
      '## Title',
      '',
      '## Ünïcode Ok',
      '',
      '## A *bold* `code` word',
      '',
      '## Install',
      '',
      '## Install',
      '',
    ].join('\n')

    const slugs = outlineFromAst(parse(source), [2, 3]).map((e) => e.slug)
    expect(slugs).toEqual(headingIdsFromHtml(carveToHtml(source)))
  })

  it('returns an empty outline for a page with no qualifying headings', () => {
    expect(outlineFromAst(parse('text\n'), [2, 3])).toEqual([])
  })
})
