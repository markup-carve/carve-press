import { basename } from 'node:path'
import { tabsExtensions, tabsRenderer, type DocumentNode, type ExtensionDefinition, type Node } from '@markup-carve/carve'
import {
  citations,
  codeCallouts,
  codeGroup,
  colorSwatch,
  defaultAttributes,
  details,
  externalLinks,
  glossary,
  headingNumbers,
  headingPermalinks,
  imgFence,
  index as indexTerms,
  listTable,
  mathBlock,
  spoiler,
  tocPlacement,
  wikilinks,
} from '@markup-carve/carve/extensions'
import type { CarvePressConfig } from '../config.js'
import { withBase } from '../layout/shell.js'
import { createShikiExtensionFromHighlighter, createShikiHighlighter, type ShikiOptions } from './shiki.js'
import { compareExtension } from './compare.js'
import { imageDefaultsExtension } from './images.js'
import { islandsExtension } from './islands.js'
import type { PressExtension } from './press-extension.js'
import { playgroundExtension, type PlaygroundAssetUrls } from './playground.js'
import { substitutionsExtension } from './substitutions.js'
import { tableScrollExtension } from './table-scroll.js'

function named(name: string, entry: PressExtension): PressExtension {
  return { name, ...entry }
}

/** A bare definition (the navigation extensions) as a stack entry. */
function definition(name: string, extension: ExtensionDefinition): PressExtension {
  return { name, extensions: [extension] }
}

function dropPermalinks(nodes: readonly Node[]): void {
  for (const node of nodes) {
    const children = (node as { children?: Node[] }).children
    if (!Array.isArray(children)) continue
    if (node.type === 'heading') {
      const last = children.at(-1)
      if (last?.type === 'link' && last.attrs?.classes?.includes('permalink') === true) {
        children.pop()
        const space = children.at(-1)
        if (space?.type === 'text' && space.value === ' ') children.pop()
      }
    }
    dropPermalinks(children)
  }
}

/**
 * Permalinks on top-level headings only, as the 0.1 extension wrote them: a
 * heading inside a container (a blog card's linked title) gets no anchor.
 */
function topLevelPermalinks(): PressExtension {
  const extension = headingPermalinks()
  const transform = extension.documentTransform!
  return definition('heading-permalinks', {
    ...extension,
    documentTransform(view: DocumentNode): DocumentNode {
      const out = transform(view)
      for (const child of out.children) {
        const nested = (child as { children?: Node[] }).children
        if (child.type !== 'heading' && Array.isArray(nested)) dropPermalinks(nested)
      }
      return out
    },
  })
}

function presetExtensions(preset: CarvePressConfig['carve']['preset']): PressExtension[] {
  const docs: PressExtension[] = [
    { name: 'tabs', extensions: tabsExtensions, renderers: { 'carve.tabs': tabsRenderer } },
    named('details', details()),
    named('math-block', mathBlock()),
    definition('external-links', externalLinks()),
    // tocPlacement only, deliberately: tableOfContents() injects a nav into
    // every document, which on this theme means a bare list of links above the
    // H1 duplicating the outline column. A page that wants one asks for it with
    // a ::: toc block.
    definition('toc', tocPlacement()),
    named('wikilinks', wikilinks()),
  ]
  const full: PressExtension[] = [
    ...docs,
    definition('headingNumbers', headingNumbers({ minLevel: 2 })),
    named('glossary', glossary()),
    named('index', indexTerms()),
    named('citations', citations()),
    named('codeCallouts', codeCallouts()),
    named('color', colorSwatch()),
    named('spoiler', spoiler()),
    named('list-table', listTable()),
    named('img-fence', imgFence()),
    named('default-attributes', defaultAttributes({})),
  ]
  if (preset === 'minimal') return []
  return preset === 'full' ? full : docs
}

/**
 * The render stack. Built-ins come first so a user extension appended from
 * config can override any of them; a later renderer for the same node type wins.
 */
export async function buildExtensionStack(
  config: CarvePressConfig,
  shiki: ShikiOptions,
  root = process.cwd(),
): Promise<PressExtension[]> {
  const highlighter = await createShikiHighlighter(shiki)
  const playgroundAssets: PlaygroundAssetUrls = {
    ...(config.playground.wasmEngine === undefined
      ? {}
      : {
          wasm: withBase(
            config.base,
            `/assets/playground/${basename(config.playground.wasmEngine)}/carve_wasm.js`,
          ),
        }),
    ...(config.playground.mermaid === undefined
      ? {}
      : { mermaid: withBase(config.base, `/assets/playground/${basename(config.playground.mermaid)}`) }),
    ...(config.playground.chart === undefined
      ? {}
      : { chart: withBase(config.base, `/assets/playground/${basename(config.playground.chart)}`) }),
  }
  return [
    createShikiExtensionFromHighlighter(highlighter),
    tableScrollExtension(),
    compareExtension(),
    playgroundExtension(playgroundAssets),
    named('code-group', codeGroup({ highlighter: (code, language) => highlighter(code, language) })),
    topLevelPermalinks(),
    imageDefaultsExtension({ root, publicDir: config.publicDir }),
    // Always present, even with nothing configured: an `::: island` block that
    // names an island the config does not define has to fail rather than render
    // as an anonymous div nobody will hydrate. A page without such a block
    // still emits no island markup and loads no island script.
    islandsExtension(config.islands),
    ...(Object.keys(config.substitutions).length === 0 ? [] : [substitutionsExtension(config.substitutions)]),
    ...presetExtensions(config.carve.preset),
    ...config.carve.extensions,
  ]
}
