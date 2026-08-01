import { describe, it, expect, vi } from 'vitest'
import { carveToHtml } from '@markup-carve/carve'
import { compareExtension } from '../src/render/compare.js'

const ext = compareExtension()
const render = (src: string) => carveToHtml(src, { extensions: [ext] })

const BLOCK = ['::: compare', '```carve', '*bold*', '```', '```html', '<p>x</p>', '```', ':::'].join(
  '\n',
)

describe('compareExtension', () => {
  it('emits CSS-only radio tabs, no script', () => {
    const html = render(BLOCK)
    expect(html).toContain('type="radio"')
    expect(html).not.toContain('<script')
  })

  it('renders the source pane and both output panes', () => {
    const html = render(BLOCK)
    expect(html).toContain('carve-compare')
    expect(html).toContain('&lt;p&gt;x&lt;/p&gt;')
    expect(html).toContain('<p>x</p>')
  })

  it('gives each block a unique radio group name', () => {
    const html = render(`${BLOCK}\n\n${BLOCK}`)
    const names = [...html.matchAll(/name="(compare-\d+)"/g)].map((m) => m[1])
    expect(new Set(names).size).toBe(2)
  })

  it('omits the live pane for a no-render block', () => {
    // The opt-out is a block-attribute line: `::: compare no-render` is not a
    // valid admonition opener and would degrade to a paragraph.
    const html = render(`{.no-render}\n${BLOCK}`)
    expect(html).toContain('&lt;p&gt;x&lt;/p&gt;')
    expect(html).not.toContain('carve-compare__live')
  })

  it('keeps authored attributes on the wrapper', () => {
    const html = render(`{#ex-1 .wide}\n${BLOCK}`)
    expect(html).toContain('id="ex-1"')
    expect(html).toContain('wide')
  })

  it('leaves an admonition that is not a compare block alone', () => {
    const html = render('::: note\nbody\n:::')
    expect(html).not.toContain('carve-compare')
    expect(html).toContain('admonition')
  })

  it('renders a compare block missing its html fence as a plain div', () => {
    // A malformed block must degrade visibly, never vanish.
    const html = render('::: compare\n```carve\n*b*\n```\n:::')
    expect(html).toContain('carve-compare--malformed')
    expect(html).toContain('*b*')
  })
})

/** Builds a `::: compare` block whose html fence is the given raw content. */
const compareBlock = (htmlContent: string, attrLine?: string) =>
  [
    ...(attrLine !== undefined ? [attrLine] : []),
    '::: compare',
    '```carve',
    '*bold*',
    '```',
    '```html',
    htmlContent,
    '```',
    ':::',
  ].join('\n')

describe('compareExtension executable-content warning', () => {
  it('warns when the live pane contains a <script> tag', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const localExt = compareExtension()
    carveToHtml(compareBlock('<script>alert(1)</script>'), { extensions: [localExt] })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toContain('<script')
    expect(warn.mock.calls[0]?.[0]).toContain('{.no-render}')
    warn.mockRestore()
  })

  it('does not warn for ordinary markup', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const localExt = compareExtension()
    carveToHtml(compareBlock('<p>hello <strong>world</strong></p>'), { extensions: [localExt] })
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('never warns for a {.no-render} block, regardless of content', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const localExt = compareExtension()
    carveToHtml(compareBlock('<script>alert(1)</script>', '{.no-render}'), { extensions: [localExt] })
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('does not repeat the warning for a second block matching the same pattern', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const localExt = compareExtension()
    const src = `${compareBlock('<script>a()</script>')}\n\n${compareBlock('<script>b()</script>')}`
    carveToHtml(src, { extensions: [localExt] })
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})
