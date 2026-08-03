import type { CarveExtension } from '@markup-carve/carve'
import type { CarvePressConfig } from './config.js'
import type { Page } from './content/discover.js'
import { BuildError, SourceError } from './errors.js'
import type { RenderedPage } from './render/page.js'

export interface RedirectEntry {
  source: string
  target: string
  claimant: string
}

export interface BuildEvents {
  buildStarted: { config: CarvePressConfig }
  /** `pages` is mutable: a handler may inject virtual pages or filter the list. */
  contentDiscovered: { pages: Page[] }
  /** `redirects` is mutable: a handler may add redirect entries before validation. */
  redirectsCollected: { pages: Page[]; redirects: RedirectEntry[] }
  /** `extensions` is mutable: a handler may add Carve extensions before rendering. */
  rendererCreated: { extensions: CarveExtension[] }
  /** `html` is mutable: a handler may post-process a page's output. */
  pageRendered: { rendered: RenderedPage; html: string }
  pageWritten: { rendered: RenderedPage; outPath: string }
  /** `lastUpdated` is keyed by absolute source path; a page missing from it has no known time. */
  buildCompleted: { rendered: RenderedPage[]; outDir: string; lastUpdated: Map<string, Date> }
}

type Handler<K extends keyof BuildEvents> = (payload: BuildEvents[K]) => void | Promise<void>

interface Registration {
  handler: Handler<keyof BuildEvents>
  owner: string
}

/**
 * The site-level extension seam. Search, sitemap, and llms.txt subscribe here
 * rather than living in core, so the build never knows they exist.
 */
export class BuildEventBus {
  private readonly handlers = new Map<keyof BuildEvents, Registration[]>()

  on<K extends keyof BuildEvents>(event: K, handler: Handler<K>, owner = 'anonymous'): void {
    const list = this.handlers.get(event) ?? []
    list.push({ handler: handler as Handler<keyof BuildEvents>, owner })
    this.handlers.set(event, list)
  }

  async emit<K extends keyof BuildEvents>(
    event: K,
    payload: BuildEvents[K],
  ): Promise<BuildEvents[K]> {
    for (const { handler, owner } of this.handlers.get(event) ?? []) {
      try {
        await handler(payload)
      } catch (error) {
        if (error instanceof BuildError || error instanceof SourceError) throw error
        const reason = error instanceof Error ? error.message : String(error)
        throw new BuildError(`extension "${owner}" failed on ${String(event)}: ${reason}`)
      }
    }
    return payload
  }
}
