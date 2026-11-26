import type { DocumentNode, Inline, Node, TextNode } from '@markup-carve/carve'
import type { NormalizedSubstitution } from '../config.js'
import type { PressExtension } from './press-extension.js'

type SubstitutionMap = Record<string, NormalizedSubstitution>

const TOKEN_RE = /\|([A-Za-z][A-Za-z0-9_-]*)\|/g

function replacementNode(substitution: NormalizedSubstitution): Inline {
  const text: Inline = { type: 'text', value: substitution.value }
  if (substitution.format === 'bold') return { type: 'strong', children: [text] }
  if (substitution.format === 'italic') return { type: 'emphasis', children: [text] }
  if (substitution.format === 'code') return { type: 'code', value: substitution.value }
  return text
}

function substituteText(node: TextNode, substitutions: SubstitutionMap, warned: Set<string>): Inline[] {
  const out: Inline[] = []
  let last = 0
  let changed = false

  for (const match of node.value.matchAll(TOKEN_RE)) {
    const token = match[0]
    const key = match[1]!
    const index = match.index ?? 0
    const substitution = substitutions[key]

    if (substitution === undefined) {
      if (!warned.has(key)) {
        warned.add(key)
        console.warn(
          `carve-press: unknown substitution "${token}" left unchanged. Add "${key}" to config.substitutions if this is intentional.`,
        )
      }
      continue
    }

    if (index > last) out.push({ type: 'text', value: node.value.slice(last, index) })
    out.push(replacementNode(substitution))
    last = index + token.length
    changed = true
  }

  if (!changed) return [node]
  if (last < node.value.length) out.push({ type: 'text', value: node.value.slice(last) })
  return out
}

// Literal content: a token inside code, raw output, math or a comment is text the author meant verbatim.
const VERBATIM = new Set(['code', 'code_block', 'raw_inline', 'raw_block', 'math', 'comment', 'frontmatter'])

function isNode(value: unknown): value is Node {
  return value !== null && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string'
}

function replaceList(nodes: unknown[], substitutions: SubstitutionMap, warned: Set<string>): unknown[] {
  const out: unknown[] = []
  for (const node of nodes) {
    if (isNode(node) && node.type === 'text') {
      out.push(...substituteText(node as TextNode, substitutions, warned))
      continue
    }
    if (isNode(node)) replaceNode(node, substitutions, warned)
    out.push(node)
  }
  return out
}

/** Every nested list, whatever key holds it: children, titles, captions, slots, terms. */
function replaceNode(node: Node, substitutions: SubstitutionMap, warned: Set<string>): void {
  if (VERBATIM.has(node.type)) return
  const record = node as unknown as Record<string, unknown>
  for (const [key, value] of Object.entries(record)) {
    if (key === 'pos' || key === 'attrs' || key === 'data' || key === 'fallback') continue
    if (Array.isArray(value)) record[key] = replaceList(value, substitutions, warned)
    else if (isNode(value)) replaceNode(value, substitutions, warned)
    else if (key === 'slots' && value !== null && typeof value === 'object') {
      const slots = value as Record<string, unknown[]>
      for (const [name, list] of Object.entries(slots)) slots[name] = replaceList(list, substitutions, warned) as Node[]
    }
  }
}

export function substitutionsExtension(substitutions: SubstitutionMap): PressExtension {
  const warned = new Set<string>()
  return {
    name: 'carve-press-substitutions',
    prepare(doc: DocumentNode) {
      replaceNode(doc, substitutions, warned)
    },
  }
}
