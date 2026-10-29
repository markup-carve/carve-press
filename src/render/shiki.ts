import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { bundledLanguages, bundledLanguagesAlias, createHighlighter, type Highlighter } from 'shiki'
import type { LanguageRegistration, ShikiTransformer } from 'shiki'
import {
  transformerNotationDiff,
  transformerNotationErrorLevel,
  transformerNotationFocus,
  transformerNotationHighlight,
  transformerNotationWordHighlight,
} from '@shikijs/transformers'
import { diffCodeTransformer } from '@markup-carve/carve-grammars/shiki/diff'
import { carveLightTheme, carveDarkTheme, extendTheme } from '@markup-carve/carve-grammars/shiki/themes'
import type { Attrs, BlockExtensionRenderContext, CarveExtension } from '@markup-carve/carve'
import type { ShikiLanguage } from '../config.js'
import { fenceContent } from './fence.js'
import { syntaxPalette } from './syntax-palette.js'

function paletteRules(colors: typeof syntaxPalette.light | typeof syntaxPalette.dark) {
  const rule = (scope: string | string[], foreground: string, fontStyle?: 'bold' | 'italic') => ({
    scope,
    settings: { foreground, ...(fontStyle === undefined ? {} : { fontStyle }) },
  })
  return [
    rule('fenced_code.block.language', colors.language, 'bold'),
    rule(['punctuation.definition.fenced', 'punctuation.definition.raw'], colors.muted),
    rule(['punctuation.definition.list.unnumbered', 'punctuation.definition.list.numbered', 'punctuation.definition.list'], colors.list, 'bold'),
    rule(['punctuation.definition.list.definition', 'entity.name.tag.definition.term', 'punctuation.definition.list.continuation'], colors.definition, 'bold'),
    rule('punctuation.definition.checkbox', colors.muted),
    rule(['constant.language.checkbox', 'constant.language.checkbox.done'], colors.task, 'bold'),
    rule(['entity.name.abbreviation', 'constant.other.raw.format'], colors.language, 'bold'),
    rule('punctuation.definition.caption', colors.captionMarker, 'bold'),
    rule('markup.caption', colors.captionText, 'italic'),
  ]
}

const sharedLightTheme = extendTheme(carveLightTheme, paletteRules(syntaxPalette.light))
const sharedDarkTheme = extendTheme(carveDarkTheme, paletteRules(syntaxPalette.dark))

export interface ShikiOptions {
  langs: ShikiLanguage[]
  themes: { light: string; dark: string }
  lineNumbers?: boolean | number
}

export type ShikiHighlightCallback = (
  code: string,
  lang: string | undefined,
  attrs?: Attrs,
  ctx?: BlockExtensionRenderContext,
  figureAttrs?: Attrs,
) => string

const require = createRequire(import.meta.url)
function grammarsTextMate(file: string): LanguageRegistration {
  return JSON.parse(
    readFileSync(require.resolve(`@markup-carve/carve-grammars/textmate/${file}`), 'utf8'),
  ) as LanguageRegistration
}
const carveGrammar = grammarsTextMate('carve.tmLanguage.json')
/**
 * Carve's own csv/tsv grammars scope the separator and quoted fields, which
 * Shiki's bundled csv/tsv do not. The Carve grammar embeds them by scope name
 * (`text.csv.carve`), so they load with it and also answer top-level fences.
 */
const delimitedGrammars: Record<string, LanguageRegistration> = {
  csv: { ...grammarsTextMate('csv.tmLanguage.json'), name: 'csv' },
  tsv: { ...grammarsTextMate('tsv.tmLanguage.json'), name: 'tsv' },
}
const SPECIAL_LANGS = new Set(['ansi', 'text', 'plaintext', 'txt'])
/** Fence languages that mean "no highlighting", so rendering plain is correct. */
const PLAIN_TEXT_LANGS = new Set(['text', 'plaintext', 'txt'])
const highlighterCache = new Map<string, Promise<Highlighter>>()
/**
 * Fence attributes that tell this renderer what to do. They are consumed
 * here, so they must not survive onto the `<pre>` as authoring debris.
 */
const RENDER_DIRECTIVE_KEYS = ['title', 'hl', 'start']
const RENDER_DIRECTIVE_CLASSES = ['line-numbers', 'no-line-numbers']
const FIGURE_DIRECTIVE_KEYS = ['hl', 'start']
const FIGURE_DIRECTIVE_CLASSES = [...RENDER_DIRECTIVE_CLASSES, 'diff']
/** Shiki's own `[!code ...]` notation handling, in the order it documents. */
const NOTATION_TRANSFORMERS = [
  transformerNotationDiff,
  transformerNotationHighlight,
  transformerNotationFocus,
  transformerNotationErrorLevel,
  transformerNotationWordHighlight,
]
const NOTATION_COMMENT = /(?:\/\/|#|<!--|\/\*|--|;)\s*\[!code\s+([^\]]+)\](?:\s*(?:-->| \*\/))?/g

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
    themes: [
      opts.themes.light === 'github-light' ? sharedLightTheme : opts.themes.light,
      opts.themes.dark === 'github-dark' ? sharedDarkTheme : opts.themes.dark,
    ],
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
  const delimited = new Set<string>()
  for (const lang of merged.values()) {
    if (typeof lang !== 'string') {
      registrations.push(lang)
    } else if (lang === 'carve' || lang === 'crv') {
      registrations.push(carveGrammar)
      delimited.add('csv').add('tsv')
    } else if (lang in delimitedGrammars) {
      delimited.add(lang)
    } else if (isKnownShikiLanguage(lang)) {
      registrations.push(lang)
    }
  }
  for (const name of delimited) {
    // A registration object the user supplied under this name wins.
    if (typeof merged.get(name) === 'object') continue
    const grammar = delimitedGrammars[name]
    if (grammar !== undefined) registrations.push(grammar)
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
function cloneAttrsWithout(attrs: Attrs | undefined, keys: string[], classes: string[] = []): Attrs | undefined {
  if (attrs === undefined) return undefined
  const keyValues = attrs.keyValues === undefined ? undefined : { ...attrs.keyValues }
  for (const key of keys) delete keyValues?.[key]
  const nextClasses = attrs.classes?.filter((className) => !classes.includes(className))
  const order = attrs.order?.filter((slot) => !keys.includes(slot))
  return {
    ...attrs,
    ...(keyValues === undefined ? {} : { keyValues }),
    ...(nextClasses === undefined ? {} : { classes: nextClasses }),
    ...(order === undefined ? {} : { order }),
  }
}

function plainHighlightedBlock(content: string, lang: string | undefined, highlightedLines: Set<number> = new Set()): string {
  const cls = lang !== undefined && lang !== '' ? ` class="language-${escapeAttr(lang)}"` : ''
  const lines = content.split('\n')
  const rendered = lines
    .map((line, index) => {
      const lineNo = index + 1
      const lineClass = highlightedLines.has(lineNo) ? ' class="line highlighted"' : ' class="line"'
      return `<span${lineClass}>${escapeHtml(line)}</span>`
    })
    .join('\n')
  return `<pre><code${cls}>${rendered}\n</code></pre>`
}

function plainHighlightedBlockWithAttrs(
  content: string,
  lang: string | undefined,
  attrs: Attrs | undefined,
  highlightedLines: Set<number>,
  ctx: BlockExtensionRenderContext | undefined,
): string {
  const html = plainHighlightedBlock(content, lang, highlightedLines)
  return ctx === undefined ? html : mergeAttrsIntoPre(html, attrs, ctx)
}

function isShikiBlock(html: string): boolean {
  const openTag = /^<pre(?:\s[^>]*)?>/.exec(html)?.[0] ?? ''
  return /(^| )class="[^"]*\bshiki\b/.test(openTag)
}

function isCodeBlockWrapper(html: string): boolean {
  const openTag = /^<div(?:\s[^>]*)?>/.exec(html)?.[0] ?? ''
  return /(^| )class="[^"]*\bcode-block\b/.test(openTag)
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

function attrsKeyValues(attrs: Attrs | undefined): Record<string, string> {
  return attrs?.keyValues ?? {}
}

function parseHighlightLines(value: string | undefined, warned: Set<string>): Set<number> {
  const lines = new Set<number>()
  if (value === undefined || value.trim() === '') return lines

  let malformed = false
  for (const part of value.split(',')) {
    const token = part.trim()
    const single = /^(\d+)$/.exec(token)
    if (single !== null) {
      lines.add(Number(single[1]))
      continue
    }

    const range = /^(\d+)-(\d+)$/.exec(token)
    if (range !== null) {
      const start = Number(range[1])
      const end = Number(range[2])
      if (start <= end) {
        for (let line = start; line <= end; line++) lines.add(line)
        continue
      }
    }

    malformed = true
  }

  if (malformed && !warned.has(value)) {
    warned.add(value)
    console.warn(`carve-press: malformed code fence hl="${value}" ignored. Use 1-based lines and ranges like hl="1,3-5".`)
  }

  return lines
}

/**
 * A captioned fence's attribute line belongs to the figure (PART 9 §4b,
 * markup-carve/carve#2370), so the render directives are read from there too.
 */
function withFigureDirectives(attrs: Attrs | undefined, figureAttrs: Attrs | undefined): Attrs | undefined {
  if (figureAttrs === undefined) return attrs
  const figureClasses = (figureAttrs.classes ?? []).filter((className) => FIGURE_DIRECTIVE_CLASSES.includes(className))
  const figureKeyValues = Object.fromEntries(
    Object.entries(figureAttrs.keyValues ?? {}).filter(([key]) => FIGURE_DIRECTIVE_KEYS.includes(key)),
  )
  return {
    ...attrs,
    classes: [...new Set([...(attrs?.classes ?? []), ...figureClasses])],
    keyValues: { ...figureKeyValues, ...attrs?.keyValues },
  }
}

function lineNumberStart(opts: ShikiOptions, attrs: Attrs | undefined): number | undefined {
  const classes = attrs?.classes ?? []
  if (classes.includes('no-line-numbers')) return undefined
  const start = attrsKeyValues(attrs).start
  if (classes.includes('line-numbers')) return startNumber(start) ?? 1
  if (typeof opts.lineNumbers === 'number') return startNumber(start) ?? opts.lineNumbers
  if (opts.lineNumbers === true) return startNumber(start) ?? 1
  return undefined
}

function startNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : undefined
}

function addClass(classes: unknown, className: string): string {
  const values = Array.isArray(classes) ? classes.map(String) : typeof classes === 'string' ? classes.split(/\s+/) : []
  if (!values.includes(className)) values.push(className)
  return values.join(' ')
}

function lineHighlightTransformer(lines: Set<number>): ShikiTransformer {
  return {
    name: 'carve-press-line-highlight',
    line(hast, line) {
      if (!lines.has(line)) return
      hast.properties.class = addClass(hast.properties.class, 'highlighted')
    },
  }
}

/**
 * The notation comments are instructions to the renderer, not code. Copying a
 * snippet that still says `[!code ++]` pastes a syntax error into the reader's
 * editor, so the copy payload sheds them the same way the highlighter does.
 */
function stripNotationComments(content: string): string {
  return content
    .split('\n')
    .map((line) => line.replace(NOTATION_COMMENT, '').trimEnd())
    .join('\n')
}

/**
 * Inline rather than a font or a sprite: the button has to render correctly on
 * the first paint of a static page with no runtime.
 */
const COPY_ICON =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="5.5" y="5.5" width="8" height="9" rx="1.5"/><path d="M10.5 3.5v-1a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h1"/></svg>'
const CHECK_ICON =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5 6.5 12 13 4.5"/></svg>'

function wrapCodeBlock(opts: {
  html: string
  content: string
  lang: string | undefined
  title?: string
  lineStart?: number
  /** True only when the fence went through the transformers that consume them. */
  notationConsumed?: boolean
  ctx?: BlockExtensionRenderContext
}): string {
  const escapeText = opts.ctx?.escapeHtml ?? escapeHtml
  const escapeValue = opts.ctx?.escapeAttr ?? escapeAttr
  const classes = ['code-block']
  const style = opts.lineStart === undefined ? '' : ` style="--code-block-line-start: ${opts.lineStart - 1}"`
  if (opts.lineStart !== undefined) classes.push('code-block--line-numbers')
  const langAttr = opts.lang === undefined || opts.lang === '' ? '' : ` data-lang="${escapeValue(opts.lang)}"`
  const title = opts.title === undefined ? '' : `<div class="code-block__title">${escapeText(opts.title)}</div>`
  return `<div class="${classes.join(' ')}"${langAttr}${style}>${title}<button class="code-block__copy" type="button" aria-label="Copy code"><span class="code-block__copy-icon" aria-hidden="true">${COPY_ICON}</span><span class="code-block__copy-check" aria-hidden="true">${CHECK_ICON}</span></button><template data-code-block-copy>${escapeText(
    opts.notationConsumed === true ? stripNotationComments(opts.content) : opts.content,
  )}</template>${opts.html}</div>`
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
  const warnedHl = new Set<string>()
  const baseTransformers = NOTATION_TRANSFORMERS.map((create) => create())

  return (content, lang, attrs, ctx, figureAttrs) => {
    const title = attrsKeyValues(attrs).title
    const renderedAttrs = cloneAttrsWithout(attrs, RENDER_DIRECTIVE_KEYS, RENDER_DIRECTIVE_CLASSES)
    const directives = withFigureDirectives(attrs, figureAttrs)
    const highlightedLines = parseHighlightLines(attrsKeyValues(directives).hl, warnedHl)
    const lineStart = lineNumberStart(opts, directives)
    if (lang === undefined || lang === '') {
      return wrapCodeBlock({
        html: plainHighlightedBlockWithAttrs(content, lang, renderedAttrs, highlightedLines, ctx),
        content,
        lang,
        title,
        lineStart,
        ctx,
      })
    }
    // A plain-text fence is already what the author asked for. Shiki never
    // reports these from getLoadedLanguages(), so without this they fall
    // into the branch below and warn about a language nobody needs to add.
    if (PLAIN_TEXT_LANGS.has(lang)) {
      return wrapCodeBlock({
        html: plainHighlightedBlockWithAttrs(content, lang, renderedAttrs, highlightedLines, ctx),
        content,
        lang,
        title,
        lineStart,
        ctx,
      })
    }
    if (!loaded.has(lang)) {
      // Warn once per language: a 42-page site would otherwise print the
      // same line hundreds of times and bury it.
      if (!warned.has(lang)) {
        warned.add(lang)
        console.warn(
          `carve-press: fence language "${lang}" is not registered with Shiki; rendering it plain. Add it to config.shiki.langs.`,
        )
      }
      return wrapCodeBlock({
        html: plainHighlightedBlockWithAttrs(content, lang, renderedAttrs, highlightedLines, ctx),
        content,
        lang,
        title,
        lineStart,
        ctx,
      })
    }
    // A `{.diff}` block attribute keeps the language highlighting and presents
    // the leading +/-/space as diff markers. A fresh transformer per block: it
    // captures that block's markers while Shiki tokenizes. The cast bridges the
    // grammars' Shiki 4 typings to Shiki 1; the hooks it uses exist in both.
    const isLanguageDiff = directives?.classes?.includes('diff') === true
    const html = highlighter.codeToHtml(content, {
      lang,
      themes: { light: opts.themes.light, dark: opts.themes.dark },
      defaultColor: 'light',
      transformers: [
        ...baseTransformers,
        lineHighlightTransformer(highlightedLines),
        ...(isLanguageDiff ? [diffCodeTransformer() as unknown as ShikiTransformer] : []),
      ],
    })
    return wrapCodeBlock({
      html: ctx === undefined ? html : mergeAttrsIntoPre(html, renderedAttrs, ctx),
      content,
      lang,
      title,
      lineStart,
      notationConsumed: true,
      ctx,
    })
  }
}

export function createShikiExtensionFromHighlighter(highlight: ShikiHighlightCallback): CarveExtension {
  // Core renders a figure's target through the block renderers but passes no
  // parent, so the figure records its code block target on the way down.
  const figureAttrsByTarget = new WeakMap<object, Attrs>()
  type FigureNode = { type?: string; target?: { type?: string }; attrs?: Attrs }
  const rememberFigure = (figure: FigureNode): void => {
    if (figure.target?.type === 'code_block' && figure.attrs !== undefined) figureAttrsByTarget.set(figure.target, figure.attrs)
  }
  return {
    name: 'shiki',
    blockRenderers: {
      figure(node) {
        rememberFigure(node as FigureNode)
        return undefined
      },
      figure_group(node) {
        for (const child of (node as { children?: FigureNode[] }).children ?? []) {
          if (child.type === 'figure') rememberFigure(child)
        }
        return undefined
      },
      code_block(node, ctx) {
        const lang = (node as { lang?: string }).lang
        const content = fenceContent((node as { content: string }).content)
        const attrs = (node as { attrs?: Attrs }).attrs
        const html = highlight(content, lang, attrs, ctx, figureAttrsByTarget.get(node))
        if (isCodeBlockWrapper(html)) return html
        const title = attrsKeyValues(attrs).title
        const renderedAttrs = cloneAttrsWithout(attrs, RENDER_DIRECTIVE_KEYS, RENDER_DIRECTIVE_CLASSES)
        const pre = isShikiBlock(html)
          ? mergeAttrsIntoPre(html, renderedAttrs, ctx)
          : plainHighlightedBlockWithAttrs(content, lang, renderedAttrs, new Set(), ctx)
        return wrapCodeBlock({ html: pre, content, lang, title, ctx })
      },
    },
  }
}

export async function createShikiExtension(opts: ShikiOptions): Promise<CarveExtension> {
  return createShikiExtensionFromHighlighter(await createShikiHighlighter(opts))
}
