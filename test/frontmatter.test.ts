import { describe, it, expect } from 'vitest'
import { splitFrontmatter } from '../src/content/frontmatter.js'
import { SourceError } from '../src/errors.js'

describe('splitFrontmatter', () => {
  it('splits a leading fence into data and body', () => {
    const src = '---\ntitle: Get Started\ndescription: Try it\n---\n\n# H\n'
    const r = splitFrontmatter(src)
    expect(r.data).toEqual({ title: 'Get Started', description: 'Try it' })
    expect(r.body).toBe('\n# H\n')
    expect(r.bodyStartLine).toBe(5)
  })

  it('returns empty data when there is no fence', () => {
    const r = splitFrontmatter('# H\n')
    expect(r.data).toEqual({})
    expect(r.body).toBe('# H\n')
    expect(r.bodyStartLine).toBe(1)
  })

  it('leaves an unclosed fence as body', () => {
    // No closer, so the engine would not read frontmatter either; the `---`
    // stays a thematic break.
    const r = splitFrontmatter('---\ntitle: X\n\ntext\n')
    expect(r.data).toEqual({})
    expect(r.bodyStartLine).toBe(1)
  })

  it('strips matching quotes from a value', () => {
    expect(splitFrontmatter('---\ntitle: "X: Y"\n---\n').data).toEqual({ title: 'X: Y' })
    expect(splitFrontmatter("---\ntitle: 'X'\n---\n").data).toEqual({ title: 'X' })
  })

  it('parses booleans and integers', () => {
    const r = splitFrontmatter('---\ndraft: true\norder: 3\nname: true story\n---\n')
    expect(r.data).toEqual({ draft: true, order: 3, name: 'true story' })
  })

  it('ignores blank lines and # comments inside the fence', () => {
    const r = splitFrontmatter('---\n# a comment\n\ntitle: X\n---\n')
    expect(r.data).toEqual({ title: 'X' })
  })

  it('parses a nested key as real YAML structure', () => {
    const r = splitFrontmatter('---\nnav:\n  - a\n---\nBody\n')
    expect(r.data).toEqual({ nav: ['a'] })
    expect(r.body).toBe('Body\n')
    expect(r.bodyStartLine).toBe(5)
  })

  it('reads an empty YAML value as null', () => {
    const r = splitFrontmatter('---\ntitle: X\nsubtitle:\nlayout: post\n---\n')
    expect(r.data).toEqual({ title: 'X', subtitle: null, layout: 'post' })
  })

  it('reads scalars correctly alongside a nested block', () => {
    const r = splitFrontmatter(
      '---\ntitle: Home\ndescription: Docs\nhero:\n  name: Carve\n  image:\n    src: /logo.svg\n---\n# Body\n',
    )
    expect(r.data.title).toBe('Home')
    expect(r.data.description).toBe('Docs')
    expect(r.data.hero).toEqual({ name: 'Carve', image: { src: '/logo.svg' } })
    expect(r.bodyStartLine).toBe(9)
  })

  it('keeps bodyStartLine correct for nested values', () => {
    const r = splitFrontmatter(
      '---\nlayout: home\nhero:\n  name: Carve\nfeatures:\n  - title: Visual Mnemonics\n    details: See <details>\n---\n# Body\n',
    )
    expect(r.bodyStartLine).toBe(9)
    expect(r.body).toBe('# Body\n')
    expect(r.data).toEqual({
      layout: 'home',
      hero: { name: 'Carve' },
      features: [{ title: 'Visual Mnemonics', details: 'See <details>' }],
    })
  })

  it('throws a SourceError on malformed YAML with source-file line offsets', () => {
    let caught: unknown
    try {
      splitFrontmatter('---\ntitle: X\nhero:\n  name: Carve\n bad\n---\n', 'docs/index.md')
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(SourceError)
    expect((caught as SourceError).srcPath).toBe('docs/index.md')
    expect((caught as SourceError).line).toBe(5)
    expect((caught as SourceError).message).toMatch(/^frontmatter:/)
  })

  it('throws on frontmatter that is not a YAML mapping', () => {
    expect(() => splitFrontmatter('---\n- nav\n---\n')).toThrow(/expected a YAML mapping/)
  })
})
