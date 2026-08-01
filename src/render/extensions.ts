import { codeGroup, headingPermalinks, type CarveExtension } from '@markup-carve/carve'
import type { CarvePressConfig } from '../config.js'
import { createShikiExtension, type ShikiOptions } from './shiki.js'
import { compareExtension } from './compare.js'

/**
 * The render stack. Built-ins come first so a user extension appended from
 * config can override any of them; a later renderer for the same node type wins.
 */
export async function buildExtensionStack(
  config: CarvePressConfig,
  shiki: ShikiOptions,
): Promise<CarveExtension[]> {
  return [
    await createShikiExtension(shiki),
    compareExtension(),
    codeGroup(),
    headingPermalinks(),
    ...config.carve.extensions,
  ]
}
