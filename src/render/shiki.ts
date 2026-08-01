import { createHighlighter, type Highlighter } from 'shiki'
import type { CarveExtension } from '@markup-carve/carve'

export interface ShikiOptions {
  langs: string[]
  themes: { light: string; dark: string }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function plainBlock(lang: string | undefined, content: string): string {
  const cls = lang !== undefined && lang !== '' ? ` class="language-${escapeHtml(lang)}"` : ''
  return `<pre><code${cls}>${escapeHtml(content)}\n</code></pre>`
}

/**
 * Highlight fenced code as a Carve extension rather than a post-pass over
 * rendered HTML, so the engine stays the only thing that produces markup.
 *
 * Dual-theme output uses Shiki's CSS-variable mode: the light theme lands in
 * inline `color`, the dark one in `--shiki-dark`, and the site stylesheet flips
 * between them. That gives dark-mode code with no second render.
 */
export async function createShikiExtension(opts: ShikiOptions): Promise<CarveExtension> {
  const highlighter: Highlighter = await createHighlighter({
    langs: opts.langs,
    themes: [opts.themes.light, opts.themes.dark],
  })
  const loaded = new Set(highlighter.getLoadedLanguages())
  const warned = new Set<string>()

  return {
    name: 'shiki',
    blockRenderers: {
      code_block(node) {
        const lang = (node as { lang?: string }).lang
        const content = (node as { content: string }).content
        if (lang === undefined || lang === '') return plainBlock(lang, content)
        if (!loaded.has(lang)) {
          // Warn once per language: a 42-page site would otherwise print the
          // same line hundreds of times and bury it.
          if (!warned.has(lang)) {
            warned.add(lang)
            console.warn(
              `carve-press: fence language "${lang}" is not registered with Shiki; rendering it plain. Add it to config.shiki.langs.`,
            )
          }
          return plainBlock(lang, content)
        }
        return highlighter.codeToHtml(content, {
          lang,
          themes: { light: opts.themes.light, dark: opts.themes.dark },
          defaultColor: 'light',
        })
      },
    },
  }
}
