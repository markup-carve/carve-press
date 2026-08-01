import { describe, it, expect, vi } from 'vitest'
import { carveToHtml } from '@markup-carve/carve'
import { compareExtension } from '../src/render/compare.js'
import { createShikiExtension } from '../src/render/shiki.js'

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

  it('highlights the source pane when the Shiki extension is in the stack', async () => {
    const shiki = await createShikiExtension({
      langs: ['carve', 'html'],
      themes: { light: 'github-light', dark: 'github-dark' },
    })
    const html = carveToHtml(BLOCK, { extensions: [shiki, compareExtension()] })
    const sourcePane =
      html.match(/<div class="carve-compare__source">[\s\S]*?<\/div><div class="carve-compare__output">/)?.[0] ??
      ''
    expect(sourcePane).toContain('shiki')
    expect(sourcePane).toContain('<span')
    expect(sourcePane).not.toContain('<pre><code class="language-carve">')
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

  it('names the offending block and includes an excerpt of the content', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const localExt = compareExtension()
    carveToHtml(compareBlock('<script>alert("hello from the excerpt")</script>'), {
      extensions: [localExt],
    })
    const message = warn.mock.calls[0]?.[0] as string
    expect(message).toContain('compare-1')
    expect(message).toContain('alert("hello from the excerpt")')
    warn.mockRestore()
  })

  it.each([
    ['<script> tag', '<script>alert(1)</script>'],
    ['<script src=...> tag', '<script src="x.js"></script>'],
    ['<iframe> tag', '<iframe src="x"></iframe>'],
    ['<object> tag', '<object data="x"></object>'],
    ['<embed> tag', '<embed src="x">'],
    ['onerror= attribute', '<img src="x" onerror="alert(1)">'],
    ['onclick= attribute', '<button onclick="x()">go</button>'],
    ['onclick with a space before =', '<div onclick ="x()">go</div>'],
    ['javascript: URL', '<a href="javascript:alert(1)">click</a>'],
  ])('warns for %s', (_label, htmlContent) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const localExt = compareExtension()
    carveToHtml(compareBlock(htmlContent), { extensions: [localExt] })
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it.each([
    ['a data-onset attribute', '<div data-onset="x">hi</div>'],
    ['a data-once attribute', '<div data-once="true">hi</div>'],
    ['a data-online attribute', '<span data-online="yes">hi</span>'],
    ['an aria-oncomplete attribute', '<div aria-oncomplete="x">hi</div>'],
    ['a <scriptural> tag', '<scriptural>text</scriptural>'],
  ])('does not warn for %s (false positive)', (_label, htmlContent) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const localExt = compareExtension()
    carveToHtml(compareBlock(htmlContent), { extensions: [localExt] })
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })
})
