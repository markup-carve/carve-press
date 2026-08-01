import type { Attrs, CarveExtension } from '@markup-carve/carve'

interface CodeBlockNode {
  type: string
  lang?: string
  content: string
}

/**
 * Merge structural classes ahead of the author's own `{.foo}` classes into a
 * single Attrs, so `ctx.renderAttrs` emits one `class="..."` instead of a
 * second, invalid `class=` attribute alongside a hardcoded literal one.
 */
function withBaseClasses(attrs: Attrs | undefined, ...baseClasses: string[]): Attrs {
  const classes = [...baseClasses, ...(attrs?.classes ?? [])]
  const order = attrs?.order === undefined ? undefined : attrs.order.includes('.class') ? attrs.order : ['.class', ...attrs.order]
  return { ...attrs, classes, ...(order === undefined ? {} : { order }) }
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
export function compareExtension(): CarveExtension {
  let counter = 0
  // Keyed by pattern name, not by block: a `warned` set scoped per document
  // (reset alongside `counter` in beforeRender) would still print once per
  // page on a site with the same demo repeated across many docs. Scoping it
  // to the extension instance instead - which a site build creates exactly
  // once via buildExtensionStack - warns once per distinct pattern for the
  // whole build, matching the Shiki unregistered-language warning.
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

  return {
    name: 'carve-press-compare',
    // The extension instance is shared across every page in a site build, but
    // ids only need to be unique within one document. Resetting here (fired
    // once per carveToHtml call) keeps a page's compare ids stable across
    // rebuilds instead of drifting with whatever order other pages rendered.
    beforeRender(doc) {
      counter = 0
      return doc
    },
    blockRenderers: {
      admonition(node, ctx) {
        const adm = node as {
          kind?: string
          children?: unknown[]
          attrs?: { classes?: string[] }
        }
        // Returning undefined defers to the next extension, then to the core
        // renderer - so every other admonition kind is untouched.
        if (adm.kind !== 'compare') return undefined

        const children = (adm.children ?? []) as CodeBlockNode[]
        const fences = children.filter((c) => c.type === 'code_block')
        const carve = fences.find((f) => f.lang === 'carve')
        const html = fences.find((f) => f.lang === 'html')

        if (!carve || !html) {
          const attrs = ctx.renderAttrs(withBaseClasses(node.attrs, 'carve-compare', 'carve-compare--malformed'))
          return `<div${attrs}>${ctx.renderChildren(adm.children as never, ctx.level + 1)}</div>`
        }

        const attrs = ctx.renderAttrs(withBaseClasses(node.attrs, 'carve-compare'))
        const noRender = adm.attrs?.classes?.includes('no-render') ?? false
        // `name` only has to be unique per document among compare blocks (it
        // just groups this block's own radios), which the monotonic counter
        // already guarantees. `id`/`for` must be unique across the WHOLE
        // document - an authored `{#compare-1-html}` elsewhere (plausible in
        // docs that talk about this very extension) would otherwise collide
        // and misdirect a label - so those go through ctx.uniqueId.
        const group = `compare-${++counter}`
        const renderedId = ctx.uniqueId(`${group}-rendered`)
        const htmlId = ctx.uniqueId(`${group}-html`)
        const source = `<div class="carve-compare__source"><pre><code class="language-carve">${ctx.escapeHtml(
          carve.content,
        )}\n</code></pre></div>`

        const tabs: string[] = []
        const panes: string[] = []
        if (!noRender) {
          warnIfExecutable(group, html.content)
          tabs.push(
            `<input type="radio" name="${group}" id="${renderedId}" class="carve-compare__radio" checked>`,
            `<label for="${renderedId}" class="carve-compare__label">Rendered</label>`,
          )
          panes.push(`<div class="carve-compare__pane carve-compare__live">${html.content}</div>`)
        }
        tabs.push(
          `<input type="radio" name="${group}" id="${htmlId}" class="carve-compare__radio"${
            noRender ? ' checked' : ''
          }>`,
          `<label for="${htmlId}" class="carve-compare__label">HTML</label>`,
        )
        panes.push(
          `<div class="carve-compare__pane"><pre><code class="language-html">${ctx.escapeHtml(
            html.content,
          )}\n</code></pre></div>`,
        )

        return `<div${attrs}>${source}<div class="carve-compare__output">${tabs.join(
          '',
        )}${panes.join('')}</div></div>`
      },
    },
  }
}
