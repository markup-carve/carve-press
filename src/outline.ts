import type { DocumentNode } from '@markup-carve/carve'

export interface OutlineEntry {
  level: number
  title: string
  slug: string
}

interface AnyNode {
  type: string
  level?: number
  value?: string
  attrs?: {
    id?: string
  }
  generatedId?: string
  children?: AnyNode[]
}

/**
 * Flatten a heading's inline children to plain text for the outline label.
 *
 * `code` is the inline-code node (verified against CANONICAL_INLINE_TYPES);
 * like `text` it carries a `value` and no children, so it has to be read here
 * or `## A `code` word` loses the word entirely.
 */
/** The permalink anchor is page chrome, not heading text. */
export function isPermalink(node: { type: string; attrs?: object }): boolean {
  return node.type === 'link' && (node.attrs as { classes?: string[] } | undefined)?.classes?.includes('permalink') === true
}

function textOf(node: AnyNode): string {
  if (isPermalink(node)) return ''
  if (node.type === 'text' || node.type === 'code') return node.value ?? ''
  return (node.children ?? []).map(textOf).join('')
}

/**
 * Walk the AST for headings. A regex over rendered HTML would also match a `#`
 * inside a fenced code block; only the tree knows the difference.
 */
export function outlineFromAst(ast: DocumentNode, levels: [number, number]): OutlineEntry[] {
  const [min, max] = levels
  const entries: OutlineEntry[] = []

  const visit = (node: AnyNode): void => {
    if (node.type === 'heading' && node.level !== undefined) {
      if (node.level >= min && node.level <= max) {
        const title = textOf(node).trim()
        const slug = node.attrs?.id ?? node.generatedId
        // A missing resolved id is safer to omit than to link to a wrong anchor.
        if (slug !== undefined) entries.push({ level: node.level, title, slug })
      }
    }
    for (const child of node.children ?? []) visit(child)
  }

  for (const child of (ast as unknown as AnyNode).children ?? []) visit(child)
  return entries
}
