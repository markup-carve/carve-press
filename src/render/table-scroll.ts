import type { BlockNode, CarveExtension, InlineNode, Table } from '@markup-carve/carve'

function captionText(nodes: InlineNode[]): string {
  const parts: string[] = []

  function visit(node: InlineNode): void {
    switch (node.type) {
      case 'text':
      case 'escaped_text':
        parts.push(node.value)
        return
      case 'smart_punctuation':
        parts.push(node.glyph ?? node.value)
        return
      case 'code':
        parts.push(node.value)
        return
      case 'image':
        parts.push(node.alt)
        return
      case 'math':
      case 'literal_inline':
      case 'raw_inline':
        parts.push(node.content)
        return
      case 'symbol':
        parts.push(`:${node.name}:`)
        return
      case 'autolink':
        parts.push(node.text ?? node.href)
        return
      case 'heading_ref':
        parts.push(node.target)
        return
      case 'caption_number':
        if (node.n !== undefined) parts.push(String(node.n))
        return
      case 'mention':
        parts.push(`@${node.user}`)
        return
      case 'tag':
        parts.push(`#${node.name}`)
        return
      case 'abbreviation':
        parts.push(node.abbr)
        return
      case 'substitution':
        parts.push(node.newText)
        return
      case 'critic_comment':
        parts.push(node.text)
        return
      case 'soft_break':
      case 'hard_break':
        parts.push(' ')
        return
      case 'emphasis':
      case 'strong':
      case 'underline':
      case 'strike':
      case 'superscript':
      case 'subscript':
      case 'highlight':
      case 'link':
      case 'span':
      case 'insert':
      case 'delete':
        for (const child of node.children) visit(child)
        return
      case 'inline_extension':
        for (const child of node.content) visit(child)
        return
      case 'citation_group':
        for (const item of node.items) {
          for (const child of item.prefix ?? []) visit(child)
          parts.push(`@${item.key}`)
          for (const child of item.locator ?? []) visit(child)
          for (const child of item.suffix ?? []) visit(child)
        }
        return
      case 'footnote_ref':
        if (node.number !== undefined) parts.push(String(node.number))
        return
      case 'inline_footnote':
        for (const child of node.inline) visit(child)
        return
      case 'comment':
        return
    }
  }

  for (const node of nodes) visit(node)
  return parts.join('').replace(/\s+/g, ' ').trim()
}

function captionId(nodes: InlineNode[]): string | undefined {
  for (const node of nodes) {
    if (node.attrs?.id !== undefined) return node.attrs.id

    const nested = (() => {
      switch (node.type) {
        case 'emphasis':
        case 'strong':
        case 'underline':
        case 'strike':
        case 'superscript':
        case 'subscript':
        case 'highlight':
        case 'link':
        case 'span':
        case 'insert':
        case 'delete':
          return node.children
        case 'inline_extension':
          return node.content
        case 'inline_footnote':
          return node.inline
        default:
          return undefined
      }
    })()

    if (nested !== undefined) {
      const id = captionId(nested)
      if (id !== undefined) return id
    }
  }

  return undefined
}

export function tableScrollExtension(): CarveExtension {
  let renderingInnerTable = false

  return {
    name: 'carve-press-table-scroll',
    blockRenderers: {
      table(node, ctx) {
        if (renderingInnerTable) return undefined

        const table = node as Table
        renderingInnerTable = true
        try {
          const renderedTable = ctx.renderChildren([node as BlockNode], ctx.level)
          const attrs = ['class="table-scroll"', 'tabindex="0"']
          if (table.caption !== undefined) {
            attrs.push('role="region"')
            const id = captionId(table.caption)
            if (id !== undefined) {
              attrs.push(`aria-labelledby="${ctx.escapeAttr(id)}"`)
            } else {
              attrs.push(`aria-label="${ctx.escapeAttr(captionText(table.caption))}"`)
            }
          }

          return `${ctx.indent(ctx.level)}<div ${attrs.join(' ')}>\n${renderedTable}\n${ctx.indent(
            ctx.level,
          )}</div>`
        } finally {
          renderingInnerTable = false
        }
      },
    },
  }
}
