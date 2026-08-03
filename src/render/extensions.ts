import { basename } from 'node:path'
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
  tabs,
  tocPlacement,
  wikilinks,
  type CarveExtension,
} from '@markup-carve/carve'
import type { CarvePressConfig } from '../config.js'
import { withBase } from '../layout/shell.js'
import { createShikiExtensionFromHighlighter, createShikiHighlighter, type ShikiOptions } from './shiki.js'
import { compareExtension } from './compare.js'
import { imageDefaultsExtension } from './images.js'
import { playgroundExtension, type PlaygroundAssetUrls } from './playground.js'
import { tableScrollExtension } from './table-scroll.js'

function presetExtensions(preset: CarvePressConfig['carve']['preset']): CarveExtension[] {
  const docs = [
    tabs(),
    details(),
    mathBlock(),
    externalLinks(),
    // tocPlacement only, deliberately: tableOfContents() injects a nav into
    // every document, which on this theme means a bare list of links above the
    // H1 duplicating the outline column. A page that wants one asks for it with
    // a ::: toc block.
    tocPlacement(),
    wikilinks(),
  ]
  const full = [
    ...docs,
    headingNumbers({ minLevel: 2 }),
    glossary(),
    indexTerms(),
    citations(),
    codeCallouts(),
    colorSwatch(),
    spoiler(),
    listTable(),
    imgFence(),
    defaultAttributes(),
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
): Promise<CarveExtension[]> {
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
    codeGroup({ highlighter }),
    headingPermalinks(),
    imageDefaultsExtension({ root, publicDir: config.publicDir }),
    ...presetExtensions(config.carve.preset),
    ...config.carve.extensions,
  ]
}
