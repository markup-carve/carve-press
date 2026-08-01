import { describe, it, expect } from 'vitest'
import { splitFrontmatter } from '../src/content/frontmatter.js'

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

  it('preserves a nested key as an opaque raw string', () => {
    const r = splitFrontmatter('---\nnav:\n  - a\n---\nBody\n')
    expect(r.data).toEqual({ nav: 'nav:\n  - a' })
    expect(r.body).toBe('Body\n')
    expect(r.bodyStartLine).toBe(5)
  })

  it('reads an empty value as an empty string, not a nested value', () => {
    // `subtitle:` with nothing after it is a legitimate empty scalar. Only an
    // INDENTED following line means nesting.
    const r = splitFrontmatter('---\ntitle: X\nsubtitle:\nlayout: post\n---\n')
    expect(r.data).toEqual({ title: 'X', subtitle: '', layout: 'post' })
  })

  it('reads scalars correctly alongside a nested block', () => {
    const r = splitFrontmatter(
      '---\ntitle: Home\ndescription: Docs\nhero:\n  name: Carve\n  image:\n    src: /logo.svg\n---\n# Body\n',
    )
    expect(r.data.title).toBe('Home')
    expect(r.data.description).toBe('Docs')
    expect(r.data.hero).toBe('hero:\n  name: Carve\n  image:\n    src: /logo.svg')
    expect(r.bodyStartLine).toBe(9)
  })

  it('still throws on a malformed top-level line', () => {
    expect(() => splitFrontmatter('---\nnav\n---\n')).toThrow(/expected "key: value"/)
  })
})
