import { dirname } from 'node:path'
import {
  ProfileViolationError,
  applyProfile,
  formatProfileViolation,
  parse,
  renderHtml,
  resolve,
  type CarveExtension,
  type Document,
  type Profile,
} from '@markup-carve/carve'
import type { Page } from '../content/discover.js'
import { outlineFromAst, type OutlineEntry } from '../outline.js'
import { expandIncludes } from '../include/expand.js'
import { SourceError } from '../errors.js'

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
}

export interface RenderContext {
  extensions: CarveExtension[]
  outlineLevels: [number, number]
  includeRoots: string[]
  base: string
  profile?: Profile
  profileBaseHost?: string
}

interface AnyNode {
  type: string
  level?: number
  value?: string
  href?: string
  src?: string
  attrs?: { id?: string }
  children?: AnyNode[]
}

/**
 * Collect prose text for the search index and for page titles.
 *
 * Fenced code BLOCKS are skipped on purpose - indexing them would return every
 * fence on the site for a common keyword. Inline `code` is kept: on an API
 * reference the inline-code spans are the most-searched terms, and a heading
 * like `# The `carve` CLI` would otherwise title the page "The  CLI".
 */
function searchText(node: AnyNode, out: string[]): void {
  if (node.type === 'code_block' || node.type === 'raw_block' || node.type === 'comment') return
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
    const slug = node.attrs?.id
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

function profileError(page: Page, error: ProfileViolationError): SourceError {
  const violation = error.violations[0]
  const message =
    violation === undefined
      ? 'profile violation'
      : `profile: ${formatProfileViolation(violation)}`
  return new SourceError(page.relPath, 1, 1, message)
}

/**
 * `carveToHtml` guards the source length before it parses, and that guard is
 * internal to the engine. Rendering step by step would otherwise drop a
 * profile's max-length limit without a word.
 */
function enforceProfileMaxLength(source: string, profile: Profile | undefined): void {
  if (profile === undefined) return
  const maxLength = profile.getMaxLength()
  const length = Buffer.byteLength(source, 'utf8')
  if (maxLength > 0 && length > maxLength) {
    throw new RangeError(
      `Input exceeds the profile's maximum length of ${maxLength} bytes (got ${length} bytes).`,
    )
  }
}

function applyTransforms(doc: Document, extensions: CarveExtension[]): Document {
  let out = doc
  for (const extension of extensions) {
    if (extension.afterParse !== undefined) out = extension.afterParse(out)
  }
  for (const extension of extensions) {
    if (extension.beforeRender !== undefined) out = extension.beforeRender(out)
  }
  return out
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

function rewriteContentUrls(node: AnyNode, base: string): void {
  if (node.type === 'link' && node.href !== undefined) node.href = rewriteUrl(node.href, base)
  if (node.type === 'image' && node.src !== undefined) node.src = rewriteUrl(node.src, base)

  const keyValues = (node.attrs as { keyValues?: Record<string, string> } | undefined)?.keyValues
  if (keyValues !== undefined) {
    for (const key of ['href', 'src']) {
      const value = keyValues[key]
      if (value !== undefined) keyValues[key] = rewriteUrl(value, base)
    }
    if (keyValues.srcset !== undefined) keyValues.srcset = rewriteSrcset(keyValues.srcset, base)
  }

  for (const child of node.children ?? []) rewriteContentUrls(child, base)
}

export function renderPage(page: Page, ctx: RenderContext): RenderedPage {
  let expanded: string
  try {
    expanded = expandIncludes(page.source, {
      srcPath: page.relPath,
      baseDir: dirname(page.srcPath),
      roots: ctx.includeRoots,
    }).source
  } catch (error) {
    // Include errors carry a body-relative line; shift it back to the original
    // file so the reported location is clickable.
    if (error instanceof SourceError && error.srcPath === page.relPath) {
      throw new SourceError(
        page.relPath,
        error.line + page.bodyStartLine - 1,
        error.column,
        error.message,
      )
    }
    throw error
  }

  // This is `carveToHtml` unrolled: parse, resolve, transforms, profile,
  // render. The steps have to be separate because the base rewrite operates on
  // the AST, and because outline and search read the same resolved document
  // instead of parsing the page a second time.
  let html: string
  let ast: Document
  try {
    enforceProfileMaxLength(expanded, ctx.profile)
    ast = applyTransforms(resolve(parse(expanded, { extensions: ctx.extensions })), ctx.extensions)
    if (ctx.profile !== undefined) applyProfile(ast, ctx.profile, ctx.profileBaseHost)
    rewriteContentUrls(ast as unknown as AnyNode, ctx.base)
    html = renderHtml(ast, { extensions: ctx.extensions })
  } catch (error) {
    if (error instanceof ProfileViolationError) throw profileError(page, error)
    if (ctx.profile !== undefined && error instanceof RangeError) {
      throw new SourceError(page.relPath, 1, 1, `profile: ${error.message}`)
    }
    throw error
  }
  const outline = outlineFromAst(ast, ctx.outlineLevels)

  const fmTitle = page.frontmatter.title
  const title = typeof fmTitle === 'string' && fmTitle !== '' ? fmTitle : firstH1(ast)
  if (title === undefined || title === '') {
    throw new SourceError(page.relPath, 1, 1, 'page has no frontmatter title and no H1')
  }

  const parts: string[] = []
  for (const child of (ast as unknown as AnyNode).children ?? []) searchText(child, parts)

  return {
    page,
    html,
    outline,
    searchDoc: {
      route: page.route,
      title,
      headings: outline.map((o) => o.title),
      sections: searchSections(ast, outline),
      text: normalizeSearchParts(parts),
    },
  }
}
