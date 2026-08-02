import { basename } from 'node:path'
import { codeGroup, headingPermalinks, type CarveExtension } from '@markup-carve/carve'
import type { CarvePressConfig } from '../config.js'
import { withBase } from '../layout/shell.js'
import { createShikiExtensionFromHighlighter, createShikiHighlighter, type ShikiOptions } from './shiki.js'
import { compareExtension } from './compare.js'
import { playgroundExtension, type PlaygroundAssetUrls } from './playground.js'
import { tableScrollExtension } from './table-scroll.js'

/**
 * The render stack. Built-ins come first so a user extension appended from
 * config can override any of them; a later renderer for the same node type wins.
 */
export async function buildExtensionStack(
  config: CarvePressConfig,
  shiki: ShikiOptions,
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
    ...config.carve.extensions,
  ]
}
