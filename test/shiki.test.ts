import { describe, it, expect, vi } from 'vitest'
import { carveToHtml } from '@markup-carve/carve'
import { resolveConfig } from '../src/config.js'
import { buildExtensionStack } from '../src/render/extensions.js'
import { clearHighlighterCache, createShikiExtension, createShikiHighlighter } from '../src/render/shiki.js'

const ext = await createShikiExtension({
  langs: ['js'],
  themes: { light: 'github-light', dark: 'github-dark' },
})

describe('createShikiExtension', () => {
  it('highlights a carve fence with the bundled TextMate grammar', async () => {
    const carveExt = await createShikiExtension({
      langs: ['carve'],
      themes: { light: 'github-light', dark: 'github-dark' },
    })
    const html = carveToHtml('```carve\n# Heading\n```\n', { extensions: [carveExt] })
    expect(html).toContain('shiki')
    expect(html).toContain('<span')
    expect(html).not.toMatch(/^<pre><code class="language-carve">/)
  })

  it('honors a language added through config', async () => {
    const config = resolveConfig({
      title: 'Carve',
      shiki: { langs: ['c'] },
    })
    const extensions = await buildExtensionStack(config, config.shiki)
    const html = carveToHtml('```c\nint main(void) { return 0; }\n```\n', { extensions })
    expect(html).toContain('shiki')
    expect(html).toContain('<span')
    expect(html).toContain('int')
  })

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

describe('plain-text fence languages', () => {
  it('renders a txt fence plain without warning', async () => {
    // `txt` means "no highlighting", so warning about it asks the author to fix
    // something that is already correct. Shiki never lists these as loaded.
    const ext = await createShikiExtension({
      langs: ['js'],
      themes: { light: 'github-light', dark: 'github-dark' },
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const html = carveToHtml('```txt\nhello\n```\n', { extensions: [ext] })
    expect(html).toContain('hello')
    expect(html).not.toContain('shiki')
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('still warns for a genuinely unregistered language', async () => {
    const ext = await createShikiExtension({
      langs: ['js'],
      themes: { light: 'github-light', dark: 'github-dark' },
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    carveToHtml('```brainfuck\n+++\n```\n', { extensions: [ext] })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('brainfuck'))
    warn.mockRestore()
  })
})

describe('code-group highlighting', () => {
  it('highlights a registered-language fence inside a code group', async () => {
    const config = resolveConfig({
      title: 'Carve',
      shiki: { langs: ['js'] },
    })
    const extensions = await buildExtensionStack(config, config.shiki)
    const html = carveToHtml('::: code-group\n```js\nconst x = 1\n```\n:::\n', { extensions })
    const panel = html.match(/<div class="code-group-panel">[\s\S]*?<\/div>/)?.[0] ?? ''
    expect(panel).toContain('shiki')
    expect(panel).toContain('<span')
    expect(panel).not.toContain('<pre><code class="language-js">')
  })

  it('renders an unregistered language inside a code group plain and warns', async () => {
    const config = resolveConfig({
      title: 'Carve',
      shiki: { langs: ['js'] },
    })
    const extensions = await buildExtensionStack(config, config.shiki)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const html = carveToHtml('::: code-group\n```brainfuck\n+++\n```\n:::\n', { extensions })
    const panel = html.match(/<div class="code-group-panel">[\s\S]*?<\/div>/)?.[0] ?? ''
    expect(panel).toContain('+++')
    expect(panel).toContain('<pre><code class="language-brainfuck">')
    expect(panel).not.toContain('shiki')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('brainfuck'))
    warn.mockRestore()
  })
})

describe('Shiki highlighter cache', () => {
  it('does not share unregistered-language warning state between highlight callbacks', async () => {
    clearHighlighterCache()
    const opts = {
      langs: ['js'],
      themes: { light: 'github-light', dark: 'github-dark' },
    }
    const first = await createShikiHighlighter(opts)
    const second = await createShikiHighlighter(opts)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      first('+++', 'brainfuck')
      first('+++', 'brainfuck')
      second('+++', 'brainfuck')

      expect(warn).toHaveBeenCalledTimes(2)
      expect(warn).toHaveBeenNthCalledWith(1, expect.stringContaining('brainfuck'))
      expect(warn).toHaveBeenNthCalledWith(2, expect.stringContaining('brainfuck'))
    } finally {
      warn.mockRestore()
      clearHighlighterCache()
    }
  })
})
