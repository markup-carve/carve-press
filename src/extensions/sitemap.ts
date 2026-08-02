import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { CarvePressConfig, SiteExtension } from '../config.js'
import { absoluteRouteUrl, escapeXml } from './url.js'

export interface SitemapOptions {
  hostname: string
  filename?: string
  exclude?: string[]
}

function normalizedOptions(opts: SitemapOptions): Required<SitemapOptions> {
  return {
    hostname: opts.hostname,
    filename: opts.filename ?? 'sitemap.xml',
    exclude: opts.exclude ?? [],
  }
}

export function sitemap(opts: SitemapOptions): SiteExtension {
  const options = normalizedOptions(opts)
  const excluded = new Set(options.exclude)
  let config: CarvePressConfig | undefined

  return {
    name: 'sitemap',
    setup(bus) {
      bus.on('buildStarted', (payload) => {
        config = payload.config
      })
      bus.on(
        'buildCompleted',
        async ({ rendered, outDir }) => {
          if (config === undefined) return
          const siteConfig = config
          const urls = rendered
            .filter((page) => !excluded.has(page.searchDoc.route))
            .map((page) => absoluteRouteUrl(options.hostname, siteConfig.base, page.searchDoc.route))
          const body = urls.map((url) => `  <url><loc>${escapeXml(url)}</loc></url>`).join('\n')
          const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`
          const outPath = resolve(outDir, options.filename)
          await mkdir(dirname(outPath), { recursive: true })
          await writeFile(outPath, xml, 'utf8')
        },
        'sitemap',
      )
    },
  }
}
