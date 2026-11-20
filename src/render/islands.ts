import type { Attrs, BlockExtensionNode, ExtensionRenderHost } from '@markup-carve/carve'
import { BuildError } from '../errors.js'
import { divExtension } from './div-extension.js'
import type { PressExtension } from './press-extension.js'

export type HydrateStrategy = 'load' | 'idle' | 'visible'

export interface IslandDefinition {
  /** Site-provided ES module, relative to the project root. */
  module: string
  hydrate?: HydrateStrategy
}

export type IslandsConfig = Record<string, string | IslandDefinition>

export interface NormalizedIsland {
  module: string
  hydrate: HydrateStrategy
}

const STRATEGIES = new Set<HydrateStrategy>(['load', 'idle', 'visible'])

export function normalizeIslands(islands: IslandsConfig | undefined): Record<string, NormalizedIsland> {
  const out: Record<string, NormalizedIsland> = {}
  for (const [name, value] of Object.entries(islands ?? {})) {
    const definition = typeof value === 'string' ? { module: value } : value
    const hydrate = definition.hydrate ?? 'load'
    if (!STRATEGIES.has(hydrate)) {
      throw new BuildError(`config islands["${name}"]: unknown hydrate strategy "${hydrate}"`, [
        'supported strategies: load, idle, visible',
      ])
    }
    if (typeof definition.module !== 'string' || definition.module === '') {
      throw new BuildError(`config islands["${name}"]: module is required`)
    }
    out[name] = { module: definition.module, hydrate }
  }
  return out
}

function attrValue(attrs: Attrs | undefined, key: string): string | undefined {
  return attrs?.keyValues?.find(([name]) => name === key)?.[1]
}

/**
 * Renders a mount point, never a framework.
 *
 * The block's own content is emitted inside the element and stays visible with
 * JavaScript off or broken, so an island degrades to whatever the author wrote
 * rather than to an empty box. Hydration is the site's own module: CarvePress
 * ships no runtime of its own, which is the whole reason the output has no
 * client framework in it.
 */
export function islandsExtension(islands: Record<string, NormalizedIsland>): PressExtension {
  function definitionOf(attrs: Attrs | undefined): { name: string; definition: NormalizedIsland; props?: string } {
    const name = attrValue(attrs, 'name')
    if (name === undefined || name === '') {
      throw new BuildError('an ::: island block needs a name attribute', [
        'write {name="counter"} on the line above ::: island',
      ])
    }
    const definition = islands[name]
    if (definition === undefined) {
      throw new BuildError(`island "${name}" is not configured`, [
        `add islands["${name}"] to the config, or remove the block`,
      ])
    }
    const props = attrValue(attrs, 'props')
    if (props !== undefined) {
      try {
        JSON.parse(props)
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        throw new BuildError(`island "${name}" has invalid props JSON`, [reason])
      }
    }
    return { name, definition, ...(props === undefined ? {} : { props }) }
  }

  function render(node: BlockExtensionNode, host: ExtensionRenderHost): string {
    const { name, definition, props } = definitionOf(node.attrs)
    const fallback = host.blocks(node.children, host.blockDepth + 1)
    const propsAttr = props === undefined ? '' : ` data-island-props="${host.escapeAttribute(props)}"`
    return `<div class="island" data-island="${host.escapeAttribute(name)}" data-island-hydrate="${
      definition.hydrate
    }"${propsAttr}>${fallback}</div>`
  }

  return { name: 'carve-press-islands', ...divExtension('carve-press.island', 'island', render, (claim) => definitionOf(claim.attrs)) }
}
