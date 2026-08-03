import { describe, it, expect, vi } from 'vitest'
import { carveToHtml } from '@markup-carve/carve'
import type { LanguageRegistration } from '@shikijs/types'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { resolveConfig } from '../src/config.js'
import { buildExtensionStack } from '../src/render/extensions.js'
import {
  clearHighlighterCache,
  createShikiExtension,
  createShikiHighlighter,
  highlighterCacheSizeForTest,
} from '../src/render/shiki.js'

const customGrammar = {
  name: 'custom',
  scopeName: 'source.custom',
  patterns: [{ name: 'keyword.custom', match: '\\bCUSTOM\\b' }],
} satisfies LanguageRegistration

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

  it('highlights a fence in a language supplied as a registration object without warning', async () => {
    const customExt = await createShikiExtension({
      langs: [customGrammar],
      themes: { light: 'github-light', dark: 'github-dark' },
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      const html = carveToHtml('```custom\nCUSTOM token\n```\n', { extensions: [customExt] })

      expect(html).toContain('shiki')
      expect(html).toContain('<span')
      expect(html).toContain('CUSTOM')
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('highlights a fence in a registered language', () => {
    const html = carveToHtml('```js\nconst x = 1\n```\n', { extensions: [ext] })
    expect(html).toContain('shiki')
    expect(html).toContain('const')
    expect(html).toContain('<span')
    expect(html).toContain('class="code-block"')
    expect(html).toContain('class="code-block__copy"')
    expect(html).toContain('<template data-code-block-copy>const x = 1</template>')
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
    const openTag = /<pre[^>]*>/.exec(html)?.[0] ?? ''
    expect(openTag).toContain('id="my-id"')
    expect(openTag).not.toContain('title="src/index.js"')
    expect(openTag).toContain('data-x="y"')
    expect(html).toContain('<div class="code-block__title">src/index.js</div>')
    // Shiki's own markers must survive, merged into the same class attribute
    // as the author's class, not replaced by it.
    expect((openTag.match(/class="/g) ?? []).length).toBe(1)
    expect(openTag).toContain('shiki-themes')
    expect(openTag).toContain('foo')
    expect(openTag).toMatch(/style="[^"]*"/)
    expect(openTag).toContain('tabindex="0"')
  })

  it('consumes the render directives instead of emitting them on the pre', () => {
    const html = carveToHtml(
      '{hl="1,3" .line-numbers start="5"}\n```js\nconst a = 1\nconst b = 2\nconst c = 3\n```\n',
      { extensions: [ext] },
    )
    const openTag = /<pre[^>]*>/.exec(html)?.[0] ?? ''
    expect(openTag).not.toContain('hl=')
    expect(openTag).not.toContain('start=')
    expect(openTag).not.toContain('line-numbers')
    // The wrapper is where those directives actually take effect.
    expect(html).toContain('code-block--line-numbers')
    expect(html).toContain('--code-block-line-start: 4')
    expect((html.match(/class="line highlighted"/g) ?? []).length).toBe(2)
  })

  it('renders the copy control as a labeled icon rather than a text button', () => {
    const html = carveToHtml('```js\nconst a = 1\n```\n', { extensions: [ext] })
    const button = /<button class="code-block__copy".*?<\/button>/s.exec(html)?.[0] ?? ''

    expect(button).toContain('aria-label="Copy code"')
    expect(button).toContain('class="code-block__copy-icon"')
    expect(button).toContain('class="code-block__copy-check"')
    expect(button).toContain('<svg')
    // No text node: a word here sits on top of the first line of code, which is
    // why the control is an icon that appears on hover.
    expect(button.replace(/<[^>]*>/g, '').trim()).toBe('')
  })

  it('copies code without the notation comments the renderer consumed', () => {
    const html = carveToHtml(
      '```js\nconst a = 1 // [!code ++]\nconst b = 2 // [!code highlight]\n```\n',
      { extensions: [ext] },
    )
    const copyText = /<template data-code-block-copy>(.*?)<\/template>/s.exec(html)?.[1] ?? ''
    expect(copyText).toBe('const a = 1\nconst b = 2')
    expect(html).toContain('line diff add')
  })

  it('copies a plain fence verbatim, notation-looking text included', () => {
    const html = carveToHtml('```text\nconst a = 1 // [!code ++]\n```\n', { extensions: [ext] })
    const copyText = /<template data-code-block-copy>(.*?)<\/template>/s.exec(html)?.[1] ?? ''
    // Nothing consumed the marker here, so it is content, not an instruction.
    expect(copyText).toBe('const a = 1 // [!code ++]')
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
    expect(html).not.toContain('title="src/prog.b"')
    expect(html).toContain('<div class="code-block__title">src/prog.b</div>')
    warn.mockRestore()
  })

  it('preserves fence attributes for a fence with no language', () => {
    const html = carveToHtml('{#my-id .foo data-x=y}\n```\nplain\n```\n', { extensions: [ext] })
    expect(html).toContain('id="my-id"')
    expect(html).toContain('class="foo"')
    expect(html).toContain('data-x="y"')
  })

  it('applies Shiki notation transformer classes', () => {
    const html = carveToHtml(
      ['```js', 'const add = 1 // [!code ++]', 'const remove = 2 // [!code --]', 'const hot = 3 // [!code highlight]', '```'].join(
        '\n',
      ),
      { extensions: [ext] },
    )
    expect(html).toContain('diff')
    expect(html).toContain('add')
    expect(html).toContain('remove')
    expect(html).toContain('highlighted')
    expect(html.match(/<pre[\s\S]*<\/pre>/)?.[0] ?? '').not.toContain('[!code ++]')
  })

  it('highlights 1-based line ranges from fence attributes', () => {
    const html = carveToHtml('{hl="1,3-4"}\n```js\none\ntwo\nthree\nfour\n```\n', { extensions: [ext] })
    const highlighted = html.match(/class="line highlighted"/g) ?? []
    expect(highlighted).toHaveLength(3)
  })

  it('warns once per malformed highlight range value', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    carveToHtml('{hl="x"}\n```js\none\n```\n\n{hl="x"}\n```js\ntwo\n```\n', { extensions: [ext] })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('hl="x"'))
    warn.mockRestore()
  })

  it('renders line numbers through CSS counters, not HTML text', async () => {
    const ext = await createShikiExtension({
      langs: ['js'],
      themes: { light: 'github-light', dark: 'github-dark' },
      lineNumbers: 5,
    })
    const html = carveToHtml('```js\none\ntwo\n```\n', { extensions: [ext] })
    expect(html).toContain('code-block--line-numbers')
    expect(html).toContain('--code-block-line-start: 4')
    expect(html).not.toContain('>5<')
    expect(html).not.toContain('>6<')
    const css = readFileSync(resolve(import.meta.dirname, '../theme/default.css'), 'utf8')
    expect(css).toContain('.code-block--line-numbers .line::before')
    expect(css).toContain('content: counter(code-line)')
  })

  it('lets per-fence line number classes beat config', async () => {
    const ext = await createShikiExtension({
      langs: ['js'],
      themes: { light: 'github-light', dark: 'github-dark' },
      lineNumbers: true,
    })
    expect(carveToHtml('{.no-line-numbers}\n```js\none\n```\n', { extensions: [ext] })).not.toContain(
      'code-block--line-numbers',
    )
    expect(carveToHtml('{.line-numbers start="9"}\n```js\none\n```\n', { extensions: [ext] })).toContain(
      '--code-block-line-start: 8',
    )
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
  it('shares cached highlighters for equivalent languages and separates different registrations', async () => {
    clearHighlighterCache()
    const equivalentGrammar = {
      patterns: [{ match: '\\bCUSTOM\\b', name: 'keyword.custom' }],
      scopeName: 'source.custom',
      name: 'custom',
    } satisfies LanguageRegistration
    const differentGrammar = {
      ...customGrammar,
      patterns: [{ name: 'string.custom', match: '\\bCUSTOM\\b' }],
    } satisfies LanguageRegistration
    const themes = { light: 'github-light', dark: 'github-dark' }

    try {
      await createShikiHighlighter({ langs: ['js', customGrammar], themes })
      await createShikiHighlighter({ langs: [equivalentGrammar, 'js'], themes })
      expect(highlighterCacheSizeForTest()).toBe(1)

      await createShikiHighlighter({ langs: ['js', differentGrammar], themes })
      expect(highlighterCacheSizeForTest()).toBe(2)
    } finally {
      clearHighlighterCache()
    }
  })

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
