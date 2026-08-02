import { dirname } from 'node:path'
import { carveToHtml, parse, type CarveExtension, type Document } from '@markup-carve/carve'
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
}

interface AnyNode {
  type: string
  level?: number
  value?: string
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

  // The public engine pipeline resolves heading ids and runs extension hooks
  // before rendering. Keep a second parsed AST for outline/search until the
  // engine exports applyTransforms and runProfile, which would allow one pass.
  const html = carveToHtml(expanded, { extensions: ctx.extensions })
  const ast = parse(expanded, { extensions: ctx.extensions })
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
