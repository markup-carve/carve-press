import { parse, renderWithDocumentTransforms } from '@markup-carve/carve'
import type {
  CodeBlockNode,
  DocumentNode,
  DocumentTransform,
  ExtensionDefinition,
  ExtensionRenderer,
  RenderOptions,
} from '@markup-carve/carve'

export type CodeBlockRenderer = (node: Readonly<CodeBlockNode>, defaultHtml: string) => string | null | undefined

/**
 * One entry of the render stack: the 0.2 extension bundle (`extensions`,
 * `renderers`, `transforms`) plus an optional code block renderer. The standard
 * extensions of `@markup-carve/carve/extensions` already have this shape.
 */
export interface PressExtension {
  /** Identifies the entry in the stack, for `rendererCreated` handlers and tests. */
  name?: string
  extensions?: readonly ExtensionDefinition[]
  renderers?: Readonly<Record<string, ExtensionRenderer>>
  transforms?: readonly DocumentTransform[]
  /** Only one is used: the last entry of the stack that sets one wins. */
  codeBlockRenderer?: CodeBlockRenderer
  /** Runs once per page before parsing; resets per-page counters. */
  beginPage?: () => void
  /** Edits the parsed tree in place, before outline, search and render read it. */
  prepare?: (doc: DocumentNode) => void
}

export interface MergedStack {
  options: Pick<RenderOptions, 'extensions' | 'renderers' | 'codeBlockRenderer'>
  transforms: DocumentTransform[]
  beginPage: () => void
  prepare: (doc: DocumentNode) => void
  /** The render view of a parsed tree: every registered and stack transform applied to a copy. */
  view: (doc: DocumentNode) => DocumentNode
}

/** The declaration a transform-made `block_extension` needs in the view it adds the node to. */
export function declareExtension(doc: DocumentNode, name: string): DocumentNode {
  if (doc.extensions?.some((entry) => entry.name === name) === true) return doc
  return { ...doc, extensions: [...(doc.extensions ?? []), { name, required: false, version: '1', slots: [] }] }
}

// The engine turns a throwing renderer or transform into a render-loss
// diagnostic and renders the fallback. A site build has to fail instead, so the
// first error is kept here and rethrown by the page renderer.
let pendingError: unknown

export function takePendingError(): unknown {
  const error = pendingError
  pendingError = undefined
  return error
}

function guarded<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  return (...args: A): R => {
    try {
      return fn(...args)
    } catch (error) {
      pendingError ??= error
      throw error
    }
  }
}

function guardDefinition(definition: ExtensionDefinition): ExtensionDefinition {
  return {
    ...definition,
    ...(definition.transform === undefined ? {} : { transform: guarded(definition.transform) }),
    ...(definition.documentTransform === undefined ? {} : { documentTransform: guarded(definition.documentTransform) }),
  }
}

function guardRenderer(renderer: ExtensionRenderer): ExtensionRenderer {
  return {
    ...renderer,
    ...(renderer.render === undefined ? {} : { render: guarded(renderer.render) }),
    ...(renderer.buildTime === undefined ? {} : { buildTime: guarded(renderer.buildTime) }),
  }
}

/** Later entries win for a renderer name, so a user extension can replace a built-in one. */
export function mergeStack(stack: readonly PressExtension[]): MergedStack {
  const byName = new Map<string, ExtensionDefinition>()
  const renderers: Record<string, ExtensionRenderer> = {}
  const transforms: DocumentTransform[] = []
  const begin: Array<() => void> = []
  const prepare: Array<(doc: DocumentNode) => void> = []
  let codeBlockRenderer: CodeBlockRenderer | undefined
  for (const entry of stack) {
    for (const definition of entry.extensions ?? []) byName.set(definition.name, guardDefinition(definition))
    for (const [name, renderer] of Object.entries(entry.renderers ?? {})) renderers[name] = guardRenderer(renderer)
    for (const transform of entry.transforms ?? []) transforms.push({ ...transform, transform: guarded(transform.transform) })
    if (entry.codeBlockRenderer !== undefined) codeBlockRenderer = guarded(entry.codeBlockRenderer)
    if (entry.beginPage !== undefined) begin.push(entry.beginPage)
    if (entry.prepare !== undefined) prepare.push(entry.prepare)
  }
  return {
    options: {
      extensions: [...byName.values()],
      renderers,
      ...(codeBlockRenderer === undefined ? {} : { codeBlockRenderer }),
    },
    transforms,
    beginPage: () => {
      pendingError = undefined
      for (const fn of begin) fn()
    },
    prepare: (doc) => {
      for (const fn of prepare) fn(doc)
    },
    view: (doc) => {
      let out = structuredClone(doc)
      const registered = [...byName.values()].flatMap((definition) =>
        definition.documentTransform === undefined ? [] : [definition.documentTransform],
      )
      for (const fn of [...registered, ...transforms.map((entry) => entry.transform)]) {
        try {
          out = fn(out)
        } catch {
          // The render reports a failed transform; the view skips it the same way.
        }
      }
      return out
    },
  }
}

export type { DocumentNode }

/** Renders one source through a stack, as a page does without the site steps. */
export function renderWithStack(source: string, stack: readonly PressExtension[], options: RenderOptions = {}): string {
  const merged = mergeStack(stack)
  merged.beginPage()
  const tree = parse(source, merged.options.extensions === undefined ? {} : { extensions: merged.options.extensions })
  merged.prepare(tree)
  const html = renderWithDocumentTransforms(tree, merged.transforms, { ...options, ...merged.options }).html
  const pending = takePendingError()
  if (pending !== undefined) throw pending
  return html
}
