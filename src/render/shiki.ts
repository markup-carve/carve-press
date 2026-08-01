import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { bundledLanguages, bundledLanguagesAlias, createHighlighter, type Highlighter } from 'shiki'
import type { LanguageRegistration } from '@shikijs/types'
import type { Attrs, BlockExtensionRenderContext, CarveExtension } from '@markup-carve/carve'

export interface ShikiOptions {
  langs: string[]
  themes: { light: string; dark: string }
}

const require = createRequire(import.meta.url)
const carveGrammar = JSON.parse(
  readFileSync(require.resolve('@markup-carve/carve-grammars/textmate/carve.tmLanguage.json'), 'utf8'),
) as LanguageRegistration
const SPECIAL_LANGS = new Set(['ansi', 'text', 'plaintext', 'txt'])

function isKnownShikiLanguage(lang: string): boolean {
  return lang in bundledLanguages || lang in bundledLanguagesAlias || SPECIAL_LANGS.has(lang)
}

function languageRegistrations(langs: string[]): (string | LanguageRegistration)[] {
  const registrations: (string | LanguageRegistration)[] = []
  for (const lang of langs) {
    if (lang === 'carve' || lang === 'crv') {
      registrations.push(carveGrammar)
    } else if (isKnownShikiLanguage(lang)) {
      registrations.push(lang)
    }
  }
  return registrations
}

/**
 * Render an unhighlighted `<pre>`, matching the core renderer's own
 * `code_block` shape: fence attrs (and a quoted header, which the parser
 * already resolves into `attrs.keyValues.title`) go on `<pre>`, the
 * `language-*` class goes on `<code>`. Reuses `ctx.renderAttrs` so the same
 * dangerous-attribute-name and dangerous-URL-scheme filtering the core
 * renderer applies stays the single source of truth here too.
 */
function plainBlock(
  lang: string | undefined,
  content: string,
  attrs: Attrs | undefined,
  ctx: BlockExtensionRenderContext,
): string {
  const cls = lang !== undefined && lang !== '' ? ` class="language-${ctx.escapeAttr(lang)}"` : ''
  return `<pre${ctx.renderAttrs(attrs)}><code${cls}>${ctx.escapeHtml(content)}\n</code></pre>`
}

/**
 * Splice Carve's own fence attributes into the `<pre>` tag Shiki serialized,
 * merging into Shiki's own `class` rather than replacing it (so `shiki
 * shiki-themes ...` survives alongside an author's `{.foo}`).
 *
 * This works on the final HTML string rather than Shiki's hast tree (via its
 * `pre(hast)` transformer hook): Shiki's hast serializer re-escapes whatever
 * lands in `hast.properties`, so feeding it the already-escaped string from
 * `ctx.renderAttrs` would double-escape, and rebuilding raw attribute values
 * from `node.attrs` directly would mean reimplementing `renderAttrs`'s
 * dangerous-attribute-name and dangerous-URL-scheme filtering a second time.
 * Splicing the pre-rendered, already-sanitized string keeps that filtering
 * as the single source of truth and needs no re-escaping.
 *
 * Every branch below appends the Carve attribute string somewhere in the
 * tag -- never drops it -- even if Shiki's own `class=` attribute is absent
 * or not found where expected, so an unexpected Shiki output shape mangles
 * formatting at worst, not silently loses authored metadata.
 */
function mergeAttrsIntoPre(html: string, attrs: Attrs | undefined, ctx: BlockExtensionRenderContext): string {
  const attrString = ctx.renderAttrs(attrs)
  if (attrString === '') return html
  const tagEnd = html.indexOf('>')
  const openTag = html.slice(0, tagEnd)
  const afterTag = html.slice(tagEnd)
  const carveClassMatch = /(^| )class="([^"]*)"/.exec(attrString)
  if (carveClassMatch === null) {
    return openTag + attrString + afterTag
  }
  const extraClass = carveClassMatch[2] ?? ''
  const remainder =
    attrString.slice(0, carveClassMatch.index) + attrString.slice(carveClassMatch.index + carveClassMatch[0].length)
  const shikiClassMatch = /class="([^"]*)"/.exec(openTag)
  const mergedTag =
    shikiClassMatch !== null
      ? openTag.slice(0, shikiClassMatch.index) +
        `class="${shikiClassMatch[1] ?? ''} ${extraClass}"` +
        openTag.slice(shikiClassMatch.index + shikiClassMatch[0].length)
      : `${openTag} class="${extraClass}"`
  return mergedTag + remainder + afterTag
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
    langs: languageRegistrations(opts.langs),
    themes: [opts.themes.light, opts.themes.dark],
  })
  const loaded = new Set(highlighter.getLoadedLanguages())
  const warned = new Set<string>()

  return {
    name: 'shiki',
    blockRenderers: {
      code_block(node, ctx) {
        const lang = (node as { lang?: string }).lang
        const content = (node as { content: string }).content
        const attrs = (node as { attrs?: Attrs }).attrs
        if (lang === undefined || lang === '') return plainBlock(lang, content, attrs, ctx)
        if (!loaded.has(lang)) {
          // Warn once per language: a 42-page site would otherwise print the
          // same line hundreds of times and bury it.
          if (!warned.has(lang)) {
            warned.add(lang)
            console.warn(
              `carve-press: fence language "${lang}" is not registered with Shiki; rendering it plain. Add it to config.shiki.langs.`,
            )
          }
          return plainBlock(lang, content, attrs, ctx)
        }
        const html = highlighter.codeToHtml(content, {
          lang,
          themes: { light: opts.themes.light, dark: opts.themes.dark },
          defaultColor: 'light',
        })
        return mergeAttrsIntoPre(html, attrs, ctx)
      },
    },
  }
}
