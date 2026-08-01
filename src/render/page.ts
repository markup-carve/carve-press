import { dirname } from 'node:path'
import { parse, renderHtml, type CarveExtension, type Document } from '@markup-carve/carve'
import type { Page } from '../content/discover.js'
import { outlineFromAst, type OutlineEntry } from '../outline.js'
import { expandIncludes } from '../include/expand.js'
import { SourceError } from '../errors.js'

export interface SearchDoc {
  route: string
  title: string
  headings: string[]
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
    if (error instanceof SourceError) {
      throw new SourceError(
        page.relPath,
        error.line + page.bodyStartLine - 1,
        error.column,
        error.message,
      )
    }
    throw error
  }

  const ast = parse(expanded)
  const html = renderHtml(ast, { extensions: ctx.extensions })
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
      text: parts.join(' ').replace(/\s+/g, ' ').trim(),
    },
  }
}
