import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { bundledLanguages, bundledLanguagesAlias, createHighlighter, type Highlighter } from 'shiki'
import type { LanguageRegistration } from '@shikijs/types'
import type { Attrs, BlockExtensionRenderContext, CarveExtension } from '@markup-carve/carve'
import type { ShikiLanguage } from '../config.js'

export interface ShikiOptions {
  langs: ShikiLanguage[]
  themes: { light: string; dark: string }
}

export type ShikiHighlightCallback = (code: string, lang: string | undefined) => string

const require = createRequire(import.meta.url)
const carveGrammar = JSON.parse(
  readFileSync(require.resolve('@markup-carve/carve-grammars/textmate/carve.tmLanguage.json'), 'utf8'),
) as LanguageRegistration
const SPECIAL_LANGS = new Set(['ansi', 'text', 'plaintext', 'txt'])
/** Fence languages that mean "no highlighting", so rendering plain is correct. */
const PLAIN_TEXT_LANGS = new Set(['text', 'plaintext', 'txt'])
const highlighterCache = new Map<string, Promise<Highlighter>>()

type JsonLike = null | boolean | number | string | JsonLike[] | { [key: string]: JsonLike | undefined }

function shikiLanguageName(lang: ShikiLanguage): string {
  return typeof lang === 'string' ? lang : lang.name
}

function stableJson(value: unknown): string {
  if (typeof value === 'undefined') return '"__undefined__"'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`
  const record = value as Record<string, JsonLike | undefined>
  return `{${Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`
}

function shikiLanguageCacheKey(lang: ShikiLanguage): string {
  if (typeof lang === 'string') return `bundled:${lang}`
  return `registration:${lang.name}:${stableJson(lang)}`
}

function highlighterCacheKey(opts: ShikiOptions): string {
  return JSON.stringify({
    langs: [...new Map(opts.langs.map((lang) => [shikiLanguageName(lang), shikiLanguageCacheKey(lang)])).values()].sort(),
    themes: [opts.themes.light, opts.themes.dark],
  })
}

function getCachedHighlighter(opts: ShikiOptions): Promise<Highlighter> {
  const key = highlighterCacheKey(opts)
  const cached = highlighterCache.get(key)
  if (cached !== undefined) return cached

  const highlighter = createHighlighter({
    langs: languageRegistrations(opts.langs),
    themes: [opts.themes.light, opts.themes.dark],
  }).catch((error: unknown) => {
    highlighterCache.delete(key)
    throw error
  })
  highlighterCache.set(key, highlighter)
  return highlighter
}

export function clearHighlighterCache(): void {
  for (const highlighter of highlighterCache.values()) {
    void highlighter.then((instance) => instance.dispose()).catch(() => {})
  }
  highlighterCache.clear()
}

export function highlighterCacheSizeForTest(): number {
  return highlighterCache.size
}

function isKnownShikiLanguage(lang: string): boolean {
  return lang in bundledLanguages || lang in bundledLanguagesAlias || SPECIAL_LANGS.has(lang)
}

function languageRegistrations(langs: ShikiLanguage[]): (string | LanguageRegistration)[] {
  const registrations: (string | LanguageRegistration)[] = []
  const merged = new Map<string, ShikiLanguage>()
  for (const lang of langs) {
    merged.set(shikiLanguageName(lang), lang)
  }
  for (const lang of merged.values()) {
    if (typeof lang !== 'string') {
      registrations.push(lang)
    } else if (lang === 'carve' || lang === 'crv') {
      registrations.push(carveGrammar)
    } else if (isKnownShikiLanguage(lang)) {
      registrations.push(lang)
    }
  }
  return registrations
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;')
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

function plainHighlightedBlock(content: string, lang: string | undefined): string {
  const cls = lang !== undefined && lang !== '' ? ` class="language-${escapeAttr(lang)}"` : ''
  return `<pre><code${cls}>${escapeHtml(content)}\n</code></pre>`
}

function isShikiBlock(html: string): boolean {
  const openTag = /^<pre(?:\s[^>]*)?>/.exec(html)?.[0] ?? ''
  return /(^| )class="[^"]*\bshiki\b/.test(openTag)
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
export async function createShikiHighlighter(opts: ShikiOptions): Promise<ShikiHighlightCallback> {
  const highlighter: Highlighter = await getCachedHighlighter(opts)
  const loaded = new Set(highlighter.getLoadedLanguages())
  const warned = new Set<string>()

  return (content, lang) => {
    if (lang === undefined || lang === '') return plainHighlightedBlock(content, lang)
    // A plain-text fence is already what the author asked for. Shiki never
    // reports these from getLoadedLanguages(), so without this they fall
    // into the branch below and warn about a language nobody needs to add.
    if (PLAIN_TEXT_LANGS.has(lang)) return plainHighlightedBlock(content, lang)
    if (!loaded.has(lang)) {
      // Warn once per language: a 42-page site would otherwise print the
      // same line hundreds of times and bury it.
      if (!warned.has(lang)) {
        warned.add(lang)
        console.warn(
          `carve-press: fence language "${lang}" is not registered with Shiki; rendering it plain. Add it to config.shiki.langs.`,
        )
      }
      return plainHighlightedBlock(content, lang)
    }
    return highlighter.codeToHtml(content, {
      lang,
      themes: { light: opts.themes.light, dark: opts.themes.dark },
      defaultColor: 'light',
    })
  }
}

export function createShikiExtensionFromHighlighter(highlight: ShikiHighlightCallback): CarveExtension {
  return {
    name: 'shiki',
    blockRenderers: {
      code_block(node, ctx) {
        const lang = (node as { lang?: string }).lang
        const content = (node as { content: string }).content
        const attrs = (node as { attrs?: Attrs }).attrs
        const html = highlight(content, lang)
        if (!isShikiBlock(html)) {
          return plainBlock(lang, content, attrs, ctx)
        }
        return mergeAttrsIntoPre(html, attrs, ctx)
      },
    },
  }
}

export async function createShikiExtension(opts: ShikiOptions): Promise<CarveExtension> {
  return createShikiExtensionFromHighlighter(await createShikiHighlighter(opts))
}
