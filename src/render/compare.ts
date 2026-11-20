import type { Attrs, Block, BlockExtensionNode, CodeBlockNode, ExtensionRenderHost } from '@markup-carve/carve'
import { divExtension } from './div-extension.js'
import type { PressExtension } from './press-extension.js'

/** The node with structural classes ahead of the author's own, so the host writes one `class`. */
export function withBaseClasses(node: BlockExtensionNode, ...baseClasses: string[]): BlockExtensionNode {
  const attrs: Attrs = { ...node.attrs, classes: [...baseClasses, ...(node.attrs?.classes ?? [])] }
  return { ...node, attrs }
}

/**
 * Executable-content patterns that the live pane's dangerous-attribute and
 * URL-scheme denylists (which the core renderer applies everywhere else)
 * cannot reach, because the html fence is injected verbatim rather than
 * parsed. Matched against the raw fence text, not the parsed DOM.
 *
 * Both the tag and event-attribute patterns are anchored to real syntax
 * positions rather than `\b`/a bare substring: a `\b` word boundary also
 * fires on `data-once=` and `aria-oncomplete=` (hyphen-to-letter is a
 * boundary too), and an unanchored `<script` also fires on `<scriptural>`.
 * A tag name must be followed by whitespace, `>`, or `/` (its real
 * terminator); an event attribute must be preceded by whitespace, `<`, or
 * the start of the fence (a real attribute position, never a `-`-joined
 * custom-data-attribute suffix).
 */
const EXECUTABLE_CONTENT_PATTERNS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: '<script', pattern: /<script(?=[\s>/])/i },
  { name: '<iframe', pattern: /<iframe(?=[\s>/])/i },
  { name: '<object', pattern: /<object(?=[\s>/])/i },
  { name: '<embed', pattern: /<embed(?=[\s>/])/i },
  { name: 'on<event>= attribute', pattern: /(?:^|[\s<])on[a-z][a-z0-9]*\s*=/i },
  { name: 'javascript: URL', pattern: /javascript:/i },
]

/**
 * Collapses the offending fence to a single greppable line so a warning that
 * only fires once per pattern per build (see `warned` below) still points
 * somewhere: an author with 42 pages and one `<script>` warning needs *which*
 * block, not just that one exists.
 */
function excerpt(content: string): string {
  const collapsed = content.replace(/\s+/g, ' ').trim()
  return collapsed.length > 80 ? `${collapsed.slice(0, 80)}...` : collapsed
}

/**
 * Server-render `::: compare` as CSS-only tabs.
 *
 * The live pane injects the HTML fence's own text as markup, so what a reader
 * sees rendered is byte-identical to the corpus-verified HTML shown beside it
 * and cannot drift from the engine. A `{.no-render}` attribute line opts a
 * block out, for raw-HTML and security examples that must not execute in the
 * page.
 */
export function compareExtension(): PressExtension {
  let counter = 0
  const warned = new Set<string>()

  function warnIfExecutable(group: string, content: string): void {
    for (const { name, pattern } of EXECUTABLE_CONTENT_PATTERNS) {
      if (!pattern.test(content) || warned.has(name)) continue
      warned.add(name)
      console.warn(
        `carve-press: "::: compare" block "${group}" contains ${name} in its live pane, which renders live and unescaped in the published page. Add {.no-render} to this block if the content is meant to be inert. Only the first block matching this pattern is reported per build - other blocks may also be affected. Excerpt: "${excerpt(content)}"`,
      )
    }
  }

  function render(node: BlockExtensionNode, host: ExtensionRenderHost): string {
    const depth = host.blockDepth + 1
    const fences = node.children.filter((child): child is CodeBlockNode => child.type === 'code_block')
    const carve = fences.find((fence) => fence.syntax === 'carve')
    const html = fences.find((fence) => fence.syntax === 'html')

    if (!carve || !html) {
      const attrs = host.attributes(withBaseClasses(node, 'carve-compare', 'carve-compare--malformed'), { block: true })
      return `<div${attrs}>${host.blocks(node.children, depth)}</div>`
    }

    const attrs = host.attributes(withBaseClasses(node, 'carve-compare'), { block: true })
    const noRender = node.attrs?.classes?.includes('no-render') ?? false
    const group = `compare-${++counter}`
    const renderedId = host.nextId(`${group}-rendered`)
    const htmlId = host.nextId(`${group}-html`)
    const source = `<div class="carve-compare__source">${host.blocks([carve as Block], depth)}</div>`

    const tabs: string[] = []
    const panes: string[] = []
    if (!noRender) {
      warnIfExecutable(group, html.value)
      tabs.push(
        `<input type="radio" name="${group}" id="${renderedId}" class="carve-compare__radio" checked>`,
        `<label for="${renderedId}" class="carve-compare__label">Rendered</label>`,
      )
      panes.push(`<div class="carve-compare__pane carve-compare__live">${html.value}</div>`)
    }
    tabs.push(
      `<input type="radio" name="${group}" id="${htmlId}" class="carve-compare__radio"${noRender ? ' checked' : ''}>`,
      `<label for="${htmlId}" class="carve-compare__label">HTML</label>`,
    )
    panes.push(`<div class="carve-compare__pane">${host.blocks([html as Block], depth)}</div>`)

    return `<div${attrs}><div class="carve-compare__frame">${source}<div class="carve-compare__output">${tabs.join(
      '',
    )}${panes.join('')}</div></div></div>`
  }

  return {
    name: 'carve-press-compare',
    ...divExtension('carve-press.compare', 'compare', render),
    beginPage: () => {
      counter = 0
    },
  }
}
