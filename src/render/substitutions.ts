import type { BlockNode, CarveExtension, Document, InlineNode } from '@markup-carve/carve'
import type { NormalizedSubstitution } from '../config.js'

type SubstitutionMap = Record<string, NormalizedSubstitution>

const TOKEN_RE = /\|([A-Za-z][A-Za-z0-9_-]*)\|/g

function replacementNode(substitution: NormalizedSubstitution): InlineNode {
  const text: InlineNode = { type: 'text', value: substitution.value }
  if (substitution.format === 'bold') return { type: 'strong', children: [text] }
  if (substitution.format === 'italic') return { type: 'emphasis', children: [text] }
  if (substitution.format === 'code') return { type: 'code', value: substitution.value }
  return text
}

function substituteText(node: Extract<InlineNode, { type: 'text' }>, substitutions: SubstitutionMap, warned: Set<string>): InlineNode[] {
  const out: InlineNode[] = []
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

function replaceInlines(nodes: InlineNode[], substitutions: SubstitutionMap, warned: Set<string>): InlineNode[] {
  const out: InlineNode[] = []
  for (const node of nodes) {
    if (node.type === 'text') {
      out.push(...substituteText(node, substitutions, warned))
      continue
    }
    if (
      node.type === 'code' ||
      node.type === 'raw_inline' ||
      node.type === 'literal_inline' ||
      node.type === 'critic_comment'
    ) {
      out.push(node)
      continue
    }
    if ('children' in node && Array.isArray(node.children)) {
      node.children = replaceInlines(node.children, substitutions, warned)
    }
    if (node.type === 'inline_footnote') {
      node.inline = replaceInlines(node.inline, substitutions, warned)
    }
    out.push(node)
  }
  return out
}

function replaceBlocks(blocks: BlockNode[], substitutions: SubstitutionMap, warned: Set<string>): void {
  for (const block of blocks) {
    switch (block.type) {
      case 'heading':
      case 'paragraph':
        block.children = replaceInlines(block.children, substitutions, warned)
        break
      case 'block_quote':
        replaceBlocks(block.children, substitutions, warned)
        if (block.attribution !== undefined) {
          block.attribution = replaceInlines(block.attribution, substitutions, warned)
        }
        break
      case 'list':
        for (const item of block.items) replaceBlocks(item.children, substitutions, warned)
        break
      case 'table':
        if (block.caption !== undefined) block.caption = replaceInlines(block.caption, substitutions, warned)
        for (const row of block.rows) {
          for (const cell of row.cells) cell.children = replaceInlines(cell.children, substitutions, warned)
        }
        break
      case 'admonition':
        if (block.title !== undefined) block.title = replaceInlines(block.title, substitutions, warned)
        replaceBlocks(block.children, substitutions, warned)
        break
      case 'div':
      case 'line_block':
        replaceBlocks(block.children, substitutions, warned)
        break
      case 'definition_list':
        for (const item of block.items) {
          item.terms = item.terms.map((term) => replaceInlines(term, substitutions, warned))
          for (const definition of item.definitions) replaceBlocks(definition, substitutions, warned)
        }
        break
      case 'figure':
        block.caption = replaceInlines(block.caption, substitutions, warned)
        if (block.target.type === 'block_quote') replaceBlocks(block.target.children, substitutions, warned)
        if (block.target.type === 'paragraph') {
          block.target.children = replaceInlines(block.target.children, substitutions, warned)
        }
        if (block.target.type === 'table') {
          for (const row of block.target.rows) {
            for (const cell of row.cells) cell.children = replaceInlines(cell.children, substitutions, warned)
          }
        }
        break
    }
  }
}

export function substitutionsExtension(substitutions: SubstitutionMap): CarveExtension {
  const warned = new Set<string>()
  const processed = new WeakSet<Document>()
  return {
    name: 'carve-press-substitutions',
    beforeRender(doc) {
      if (processed.has(doc)) return doc
      processed.add(doc)
      replaceBlocks(doc.children, substitutions, warned)
      return doc
    },
  }
}
