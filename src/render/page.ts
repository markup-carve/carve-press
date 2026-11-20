import { readFileSync } from 'node:fs'
import { isAbsolute, relative, resolve as resolvePath } from 'node:path'
import {
  CarveInputError,
  includeDependencies,
  parseWithDiagnostics,
  positionOf,
  renderWithDocumentTransforms,
  type Diagnostic,
  type DocumentNode,
  type Profile,
} from '@markup-carve/carve'
import { fileSystemResolver } from '@markup-carve/carve/node'
import type { Page } from '../content/discover.js'
import { isPermalink, outlineFromAst, type OutlineEntry } from '../outline.js'
import { SourceError } from '../errors.js'
import { trackImageReads } from './images.js'
import { mergeStack, takePendingError, type PressExtension } from './press-extension.js'

interface IncludeFile {
  path: string
}

export interface SearchDoc {
  route: string
  title: string
  headings: string[]
  sections: SearchSection[]
  text: string
}

export interface SearchSection {
  heading: string
  slug: string
  text: string
}

export interface RenderedPage {
  page: Page
  html: string
  outline: OutlineEntry[]
  searchDoc: SearchDoc
  includeFiles: IncludeFile[]
  /** Image files probed for dimensions; a change to one changes the HTML. */
  assetFiles?: string[]
}

export interface RenderContext {
  extensions: PressExtension[]
  outlineLevels: [number, number] | false
  includeRoots: string[]
  base: string
  profile?: Profile
}

interface AnyNode {
  type: string
  level?: number
  value?: string
  href?: string
  src?: string
  generatedId?: string
  attrs?: { id?: string; keyValues?: [string, string][] }
  children?: AnyNode[]
}

type Document = DocumentNode

/**
 * Collect prose text for the search index and for page titles.
 *
 * Fenced code BLOCKS are skipped on purpose - indexing them would return every
 * fence on the site for a common keyword. Inline `code` is kept: on an API
 * reference the inline-code spans are the most-searched terms, and a heading
 * like `# The `carve` CLI` would otherwise title the page "The  CLI".
 */
function searchText(node: AnyNode, out: string[]): void {
  if (node.type === 'code_block' || node.type === 'raw_block' || node.type === 'comment' || isPermalink(node)) return
  if (node.type === 'text' || node.type === 'code') {
    out.push(node.value ?? '')
    return
  }
  for (const child of node.children ?? []) searchText(child, out)
}

function firstH1(ast: Document): string | undefined {
  const visit = (node: AnyNode): string | undefined => {
    if (node.type === 'heading' && node.level === 1) {
      const parts: string[] = []
      searchText(node, parts)
      return parts.join('').trim()
    }
    for (const child of node.children ?? []) {
      const found = visit(child)
      if (found !== undefined) return found
    }
    return undefined
  }
  for (const child of (ast as unknown as AnyNode).children ?? []) {
    const found = visit(child)
    if (found !== undefined) return found
  }
  return undefined
}

function textOf(node: AnyNode): string {
  const parts: string[] = []
  searchText(node, parts)
  return parts.join('').trim()
}

function normalizeSearchParts(parts: string[]): string {
  return parts.join(' ').replace(/\s+/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim()
}

function sectionText(node: AnyNode, out: string[]): void {
  if (node.type === 'heading') return
  searchText(node, out)
}

function normalizedText(nodes: AnyNode[]): string {
  const parts: string[] = []
  for (const node of nodes) sectionText(node, parts)
  return normalizeSearchParts(parts)
}

function searchSections(ast: Document, outline: OutlineEntry[]): SearchSection[] {
  const outlineKeys = new Set(outline.map((entry) => `${entry.level}\0${entry.slug}`))
  const sections: SearchSection[] = []
  const children = (ast as unknown as AnyNode).children ?? []

  for (let i = 0; i < children.length; i += 1) {
    const node = children[i]
    if (node === undefined || node.type !== 'heading' || node.level === undefined) continue
    const slug = node.attrs?.id ?? node.generatedId
    if (slug === undefined || !outlineKeys.has(`${node.level}\0${slug}`)) continue

    const body: AnyNode[] = []
    for (let j = i + 1; j < children.length; j += 1) {
      const next = children[j]
      if (
        next === undefined ||
        (next.type === 'heading' && next.level !== undefined && next.level <= node.level)
      ) {
        break
      }
      body.push(next)
    }

    sections.push({
      heading: textOf(node),
      slug,
      text: normalizedText(body),
    })
  }

  return sections
}

/** A profile turns a construct it does not allow into this loss; a site build treats it as an error. */
const PROFILE_LOSS = 'profile-construct-degraded'

// C2-H-163 refuses a source over `max_length` before parsing, but only when it
// renders source; a page renders its parsed tree, so the limit is applied here.
const PROFILE_MAX_BYTES: Partial<Record<Profile, number>> = { comment: 100_000, minimal: 10_000 }

function enforceProfileMaxLength(page: Page, profile: Profile | undefined): void {
  const limit = profile === undefined ? undefined : PROFILE_MAX_BYTES[profile]
  if (limit === undefined || Buffer.byteLength(page.source, 'utf8') <= limit) return
  throw new SourceError(page.relPath, 1, 1, `profile: the input is longer than the ${limit} bytes the profile ${profile} accepts`)
}

function isIncludeFailure(diagnostic: Diagnostic): boolean {
  return diagnostic.code.startsWith('include-') && diagnostic.severity !== 'hint'
}

function rethrowPending(): void {
  const pending = takePendingError()
  if (pending !== undefined) throw pending
}

function includeError(page: Page, diagnostic: Diagnostic, root: string | undefined): SourceError {
  const inPage = diagnostic.file === undefined
  let text = page.source
  let file = page.relPath
  if (!inPage && root !== undefined) {
    const full = resolvePath(root, diagnostic.file!)
    const withinRoot = relative(root, full)
    file = withinRoot.startsWith('..') || isAbsolute(withinRoot) ? '[outside-root]' : withinRoot
    try {
      text = readFileSync(full, 'utf8')
    } catch {
      text = ''
    }
  }
  const at = diagnostic.range === undefined || text === '' ? { line: 1, column: 1 } : positionOf(text, diagnostic.range.startOffset)
  const line = inPage ? at.line + page.bodyStartLine - 1 : at.line
  return new SourceError(file, line, at.column, `${diagnostic.code} - ${diagnostic.message}`)
}

function shouldRewriteUrl(value: string, base: string): boolean {
  if (!value.startsWith('/') || value.startsWith('//')) return false
  return base !== '/' && !value.startsWith(base)
}

function withContentBase(base: string, value: string): string {
  return `${base.replace(/\/$/, '')}${value}`
}

function rewriteUrl(value: string, base: string): string {
  return shouldRewriteUrl(value, base) ? withContentBase(base, value) : value
}

function rewriteSrcset(value: string, base: string): string {
  return value
    .split(',')
    .map((part) => {
      const trimmed = part.trim()
      const match = /^(\S+)(\s+.*)?$/.exec(trimmed)
      if (match === null) return part
      return `${rewriteUrl(match[1]!, base)}${match[2] ?? ''}`
    })
    .join(', ')
}

/**
 * Every nested node, whatever key holds it.
 *
 * Only `children` used to be walked, so a link in a list item (`list.items`), a
 * table cell (`table.rows` / `table_row.cells`), a footnote body
 * (`document.footnoteDefs`) or a figure caption (`figure.caption`) never
 * reached the base rewrite (#49). Enumerating by shape rather than by a list of
 * keys keeps a construct added to the AST later from silently opting out again.
 */
function childNodes(node: AnyNode): AnyNode[] {
  const out: AnyNode[] = []
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== 'object') return
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry)
      return
    }
    const candidate = value as AnyNode
    if (typeof candidate.type === 'string') {
      out.push(candidate)
      return
    }
    for (const entry of Object.values(value)) visit(entry)
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === 'pos' || key === 'attrs') continue
    visit(value)
  }
  return out
}

function rewriteContentUrls(node: AnyNode, base: string): void {
  if ((node.type === 'link' || node.type === 'link_reference_definition') && node.href !== undefined) {
    node.href = rewriteUrl(node.href, base)
  }
  if (node.type === 'image' && node.src !== undefined) node.src = rewriteUrl(node.src, base)

  for (const pair of node.attrs?.keyValues ?? []) {
    const key = pair[0].toLowerCase()
    if (key === 'href' || key === 'src') pair[1] = rewriteUrl(pair[1], base)
    else if (key === 'srcset') pair[1] = rewriteSrcset(pair[1], base)
  }

  for (const child of childNodes(node)) rewriteContentUrls(child, base)
}

export function renderPage(page: Page, ctx: RenderContext): RenderedPage {
  const { value, paths } = trackImageReads(() => renderUntracked(page, ctx))
  return paths.length === 0 ? value : { ...value, assetFiles: paths }
}

function renderUntracked(page: Page, ctx: RenderContext): RenderedPage {
  const legacyInclude = /(^|\n)([ \t]*)%%[ \t]*@include:/.exec(page.source)
  if (legacyInclude !== null) {
    const directiveOffset = legacyInclude.index + legacyInclude[1]!.length
    const bodyLine = page.source.slice(0, directiveOffset).split('\n').length
    throw new SourceError(
      page.relPath,
      bodyLine + page.bodyStartLine - 1,
      legacyInclude[2]!.length + 1,
      '%% @include: is no longer expanded; use {{ path }}',
    )
  }

  // Parse once: the base rewrite operates on the tree, and outline and search
  // read the same resolved document instead of parsing the page a second time.
  enforceProfileMaxLength(page, ctx.profile)
  const stack = mergeStack(ctx.extensions)
  stack.beginPage()
  const root = ctx.includeRoots.at(-1)
  const includeFiles: IncludeFile[] = []
  const parsed = parseWithDiagnostics(page.source, {
    ...(stack.options.extensions === undefined ? {} : { extensions: stack.options.extensions }),
    ...(root === undefined
      ? {}
      : { includes: { resolver: fileSystemResolver(root), file: relative(root, page.srcPath).split('\\').join('/') } }),
  })
  rethrowPending()
  const failure = parsed.diagnostics.find(isIncludeFailure)
  if (failure !== undefined) throw includeError(page, failure, root)
  const ast = parsed.document
  for (const dependency of includeDependencies(ast)) {
    if (dependency.file === undefined || root === undefined) continue
    const path = resolvePath(root, dependency.file)
    if (!includeFiles.some((file) => file.path === path)) includeFiles.push({ path })
  }
  stack.prepare(ast)
  rewriteContentUrls(ast as unknown as AnyNode, ctx.base)
  let html: string
  try {
    const result = renderWithDocumentTransforms(ast, stack.transforms, {
      ...stack.options,
      ...(ctx.profile === undefined ? {} : { profile: ctx.profile }),
    })
    rethrowPending()
    const loss = ctx.profile === undefined ? undefined : result.diagnostics.find((d) => d.code === PROFILE_LOSS)
    if (loss !== undefined) {
      const line = loss.range === undefined ? 1 : positionOf(page.source, loss.range.startOffset).line
      throw new SourceError(page.relPath, line + page.bodyStartLine - 1, 1, `profile: ${loss.message}`)
    }
    html = result.html
  } catch (error) {
    if (error instanceof CarveInputError) throw new SourceError(page.relPath, 1, 1, `profile: ${error.message}`)
    throw error
  }
  // Outline and search read what the page shows, as 0.1 did by transforming
  // before reading: heading numbers belong in the outline labels too.
  const view = stack.view(ast)
  takePendingError()
  const outline = ctx.outlineLevels === false ? [] : outlineFromAst(view, ctx.outlineLevels)

  const fmTitle = page.frontmatter.title
  const title = typeof fmTitle === 'string' && fmTitle !== '' ? fmTitle : firstH1(view)
  if (title === undefined || title === '') {
    throw new SourceError(page.relPath, 1, 1, 'page has no frontmatter title and no H1')
  }

  const parts: string[] = []
  for (const child of (view as unknown as AnyNode).children ?? []) searchText(child, parts)

  return {
    page,
    html,
    outline,
    includeFiles,
    searchDoc: {
      route: page.route,
      title,
      headings: outline.map((o) => o.title),
      sections: searchSections(view, outline),
      text: normalizeSearchParts(parts),
    },
  }
}
