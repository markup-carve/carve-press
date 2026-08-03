import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { CarvePressConfig, SiteExtension } from '../config.js'
import { publicRenderedPages } from './derived.js'
import { absoluteRouteUrl, escapeXml } from './url.js'
import { localePrefixes, translationsOf } from '../locales.js'

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
        async ({ rendered, outDir, lastUpdated }) => {
          if (config === undefined) return
          const siteConfig = config
          const pages = publicRenderedPages(rendered).filter(
            (page) => !excluded.has(page.searchDoc.route),
          )
          const prefixes = localePrefixes(siteConfig)
          const routes = new Set(pages.map((page) => page.searchDoc.route))
          const langOf = (prefix: string): string =>
            siteConfig.locales[prefix]?.lang ?? (prefix.replace(/^\/|\/$/g, '') || 'x-default')

          const entries = pages.map((page) => ({
            url: absoluteRouteUrl(options.hostname, siteConfig.base, page.searchDoc.route),
            // Omitted rather than guessed: a lastmod of "now" on every page
            // tells a crawler the whole site changed on every deploy.
            lastmod: lastUpdated.get(page.page.srcPath),
            // Only translations that were actually written: advertising a page
            // that does not exist earns a crawl error, not a ranking.
            alternates:
              prefixes.length < 2
                ? []
                : translationsOf(page.searchDoc.route, prefixes, routes).map((translation) => ({
                    lang: langOf(translation.prefix),
                    url: absoluteRouteUrl(options.hostname, siteConfig.base, translation.route),
                  })),
          }))

          const body = entries
            .map(({ url, lastmod, alternates }) => {
              const parts = [`<loc>${escapeXml(url)}</loc>`]
              if (lastmod !== undefined) parts.push(`<lastmod>${lastmod.toISOString().slice(0, 10)}</lastmod>`)
              for (const alternate of alternates) {
                parts.push(
                  `<xhtml:link rel="alternate" hreflang="${escapeXml(alternate.lang)}" href="${escapeXml(alternate.url)}"/>`,
                )
              }
              return `  <url>${parts.join('')}</url>`
            })
            .join('\n')
          const namespaces =
            prefixes.length < 2
              ? 'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"'
              : 'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml"'
          const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset ${namespaces}>\n${body}\n</urlset>\n`
          const outPath = resolve(outDir, options.filename)
          await mkdir(dirname(outPath), { recursive: true })
          await writeFile(outPath, xml, 'utf8')
        },
        'sitemap',
      )
    },
  }
}
