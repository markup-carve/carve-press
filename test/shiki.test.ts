import { describe, it, expect, vi } from 'vitest'
import { carveToHtml } from '@markup-carve/carve'
import { createShikiExtension } from '../src/render/shiki.js'

const ext = await createShikiExtension({
  langs: ['js'],
  themes: { light: 'github-light', dark: 'github-dark' },
})

describe('createShikiExtension', () => {
  it('highlights a fence in a registered language', () => {
    const html = carveToHtml('```js\nconst x = 1\n```\n', { extensions: [ext] })
    expect(html).toContain('shiki')
    expect(html).toContain('const')
    expect(html).toContain('<span')
  })

  it('emits both theme variants as CSS variables', () => {
    const html = carveToHtml('```js\nconst x = 1\n```\n', { extensions: [ext] })
    expect(html).toContain('--shiki-dark')
  })

  it('renders an unregistered language plain and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const html = carveToHtml('```brainfuck\n+++\n```\n', { extensions: [ext] })
    expect(html).toContain('+++')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('brainfuck'))
    warn.mockRestore()
  })

  it('renders a fence with no language plain', () => {
    const html = carveToHtml('```\nplain\n```\n', { extensions: [ext] })
    expect(html).toContain('plain')
  })

  it('escapes HTML in an unhighlighted block', () => {
    const html = carveToHtml('```\n<script>x</script>\n```\n', { extensions: [ext] })
    expect(html).not.toContain('<script>x')
    expect(html).toContain('&lt;script&gt;')
  })

  it('escapes HTML in a highlighted, registered-language block', () => {
    const html = carveToHtml('```js\n<script>alert(1)</script>\n```\n', { extensions: [ext] })
    expect(html).not.toContain('<script>alert(1)</script>')
  })

  it('preserves fence attributes and title on the highlighted path, alongside Shiki\'s own class/style/tabindex', () => {
    const html = carveToHtml(
      '{#my-id .foo data-x=y}\n```js "src/index.js"\nconst x = 1\n```\n',
      { extensions: [ext] },
    )
    const openTag = /^<pre[^>]*>/.exec(html)?.[0] ?? ''
    expect(openTag).toContain('id="my-id"')
    expect(openTag).toContain('title="src/index.js"')
    expect(openTag).toContain('data-x="y"')
    // Shiki's own markers must survive, merged into the same class attribute
    // as the author's class, not replaced by it.
    expect((openTag.match(/class="/g) ?? []).length).toBe(1)
    expect(openTag).toContain('shiki-themes')
    expect(openTag).toContain('foo')
    expect(openTag).toMatch(/style="[^"]*"/)
    expect(openTag).toContain('tabindex="0"')
  })

  it('preserves fence attributes and title for an unregistered language', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const html = carveToHtml(
      '{#my-id .foo data-x=y}\n```brainfuck "src/prog.b"\n+++\n```\n',
      { extensions: [ext] },
    )
    expect(html).toContain('id="my-id"')
    expect(html).toContain('class="foo"')
    expect(html).toContain('data-x="y"')
    expect(html).toContain('title="src/prog.b"')
    warn.mockRestore()
  })

  it('preserves fence attributes for a fence with no language', () => {
    const html = carveToHtml('{#my-id .foo data-x=y}\n```\nplain\n```\n', { extensions: [ext] })
    expect(html).toContain('id="my-id"')
    expect(html).toContain('class="foo"')
    expect(html).toContain('data-x="y"')
  })
})
