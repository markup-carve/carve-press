import type { Block, BlockExtensionNode, DocumentNode, ExtensionRenderHost, Node, TableNode } from '@markup-carve/carve'
import { declareExtension, type PressExtension } from './press-extension.js'

const NAME = 'carve-press.table-scroll'

function captionId(nodes: readonly Node[]): string | undefined {
  for (const node of nodes) {
    if (node.attrs?.id !== undefined) return node.attrs.id
    const children = (node as { children?: Node[] }).children
    if (Array.isArray(children)) {
      const id = captionId(children)
      if (id !== undefined) return id
    }
  }
  return undefined
}

// The region is named after what the caption says now: a deletion is left out.
function captionText(nodes: readonly Node[], out: string[] = []): string[] {
  for (const node of nodes) {
    if (node.type === 'delete' || node.type === 'comment') continue
    const value = (node as { value?: unknown }).value
    if (typeof value === 'string' && (node.type === 'text' || node.type === 'code' || node.type === 'math')) out.push(value)
    else if (node.type === 'soft_break' || node.type === 'hard_break') out.push(' ')
    else if (node.type === 'image') out.push((node as { alt?: string }).alt ?? '')
    const children = (node as { children?: Node[] }).children
    if (Array.isArray(children)) captionText(children, out)
  }
  return out
}

function wrapTables(blocks: Block[]): { blocks: Block[]; wrapped: boolean } {
  let wrapped = false
  const out = blocks.map((block): Block => {
    if (block.type === 'table') {
      wrapped = true
      const wrapper: BlockExtensionNode = { type: 'block_extension', name: NAME, version: '1', children: [block], fallback: [block] }
      return wrapper
    }
    const children = (block as { children?: unknown }).children
    if (!Array.isArray(children) || children.length === 0 || typeof (children[0] as Node | undefined)?.type !== 'string') return block
    const inner = wrapTables(children as Block[])
    if (!inner.wrapped) return block
    wrapped = true
    return { ...block, children: inner.blocks } as Block
  })
  return { blocks: out, wrapped }
}

function render(node: BlockExtensionNode, host: ExtensionRenderHost): string {
  const table = node.children[0] as TableNode | undefined
  const attrs = ['class="table-scroll"', 'tabindex="0"']
  if (table?.caption !== undefined) {
    attrs.push('role="region"')
    const id = captionId(table.caption.children)
    if (id !== undefined) attrs.push(`aria-labelledby="${host.escapeAttribute(id)}"`)
    else attrs.push(`aria-label="${host.escapeAttribute(captionText(table.caption.children).join('').replace(/\s+/g, ' ').trim())}"`)
  }
  const indent = '  '.repeat(host.blockDepth)
  return `<div ${attrs.join(' ')}>\n${indent}  ${host.blocks(node.children, host.blockDepth + 1)}\n${indent}</div>`
}

/** Wraps every table in a keyboard-focusable scroll region; a captioned one is named after its caption. */
export function tableScrollExtension(): PressExtension {
  return {
    name: 'carve-press-table-scroll',
    extensions: [{ name: NAME, version: '1', props: {}, slots: {} }],
    renderers: { [NAME]: { version: '1', render: (node, host) => render(node as BlockExtensionNode, host) } },
    transforms: [
      {
        name: NAME,
        transform(doc: DocumentNode): DocumentNode {
          const result = wrapTables(doc.children as Block[])
          return result.wrapped ? declareExtension({ ...doc, children: result.blocks }, NAME) : doc
        },
      },
    ],
  }
}
