import type { Attrs, BlockExtensionRenderContext, CarveExtension } from '@markup-carve/carve'
import { BuildError } from '../errors.js'

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

interface IslandNode {
  kind?: string
  attrs?: Attrs
  children?: unknown[]
}

function attrValue(attrs: Attrs | undefined, key: string): string | undefined {
  return attrs?.keyValues?.[key]
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
export function islandsExtension(islands: Record<string, NormalizedIsland>): CarveExtension {
  return {
    name: 'carve-press-islands',
    blockRenderers: {
      admonition(node, ctx) {
        const island = node as IslandNode
        // A `::: island` block is an admonition whose kind is `island`; every
        // other kind falls through to the next extension and then to the core.
        if (island.kind !== 'island') return undefined

        const name = attrValue(island.attrs, 'name')
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

        const props = attrValue(island.attrs, 'props')
        if (props !== undefined) {
          try {
            JSON.parse(props)
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error)
            throw new BuildError(`island "${name}" has invalid props JSON`, [reason])
          }
        }

        const fallback = ctx.renderChildren((island.children ?? []) as never, ctx.level + 1)
        const propsAttr = props === undefined ? '' : ` data-island-props="${ctx.escapeAttr(props)}"`
        return `<div class="island" data-island="${ctx.escapeAttr(name)}" data-island-hydrate="${
          definition.hydrate
        }"${propsAttr}>${fallback}</div>`
      },
    },
  }
}
