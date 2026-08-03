import { mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { CarvePressConfig, SiteExtension } from '../config.js'
import { absoluteRouteUrl } from './url.js'

export interface RobotsOptions {
  /** Sitemap filename to advertise, or false to advertise none. */
  sitemap?: string | false
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function body(config: CarvePressConfig, sitemapFile: string | false): string {
  const lines = ['User-agent: *', 'Allow: /']
  // A Sitemap line has to be absolute, so it appears only when the site knows
  // its own hostname. Emitting a relative one would be a line crawlers ignore.
  if (sitemapFile !== false && config.hostname !== undefined && config.hostname !== '') {
    lines.push('', `Sitemap: ${absoluteRouteUrl(config.hostname, config.base, `/${sitemapFile}`)}`)
  }
  return `${lines.join('\n')}\n`
}

/**
 * Writes robots.txt unless the site ships its own.
 *
 * A file copied from publicDir is the author's explicit answer to this
 * question, and silently replacing it would be the kind of quiet override that
 * is only discovered by a crawler doing the wrong thing weeks later.
 */
export function robots(opts: RobotsOptions = {}): SiteExtension {
  const sitemapFile = opts.sitemap ?? 'sitemap.xml'
  let config: CarvePressConfig | undefined

  return {
    name: 'robots',
    setup(bus) {
      bus.on('buildStarted', (payload) => {
        config = payload.config
      })
      bus.on(
        'buildCompleted',
        async ({ outDir }) => {
          if (config === undefined) return
          const outPath = resolve(outDir, 'robots.txt')
          if (await exists(outPath)) return
          await mkdir(dirname(outPath), { recursive: true })
          await writeFile(outPath, body(config, sitemapFile), 'utf8')
        },
        'robots',
      )
    },
  }
}
