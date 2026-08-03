import { mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { CarvePressConfig, SiteExtension } from '../config.js'
import { BuildError } from '../errors.js'
import type { RenderedPage } from '../render/page.js'
import { absoluteRouteUrl, escapeXml } from './url.js'
import { localePrefixFor, localePrefixes } from '../locales.js'
import { publicRenderedPages } from './derived.js'

export interface FeedOptions {
  filename?: string
  title?: string
  description?: string
  limit?: number
  type?: 'rss' | 'atom'
}

function pageDate(page: RenderedPage): Date | undefined {
  const date = page.page.frontmatter.date
  if (typeof date !== 'string') return undefined
  const time = Date.parse(date)
  return Number.isFinite(time) ? new Date(time) : undefined
}

async function updated(page: RenderedPage): Promise<Date> {
  const date = pageDate(page)
  if (date !== undefined) return date
  try {
    return (await stat(page.page.srcPath)).mtime
  } catch {
    return new Date(0)
  }
}

function description(page: RenderedPage): string {
  const excerpt = page.page.frontmatter.excerpt
  if (typeof excerpt === 'string') return excerpt
  const desc = page.page.frontmatter.description
  if (typeof desc === 'string') return desc
  return page.searchDoc.text
}

async function feedPages(rendered: RenderedPage[], config: CarvePressConfig): Promise<Array<{ page: RenderedPage; date: Date }>> {
  const publicPages = publicRenderedPages(rendered)
  const source =
    config.blog === undefined
      ? publicPages
      : publicPages.filter((page) => page.page.relPath.startsWith(`${config.blog!.dir.replace(/\/+$/, '')}/`))
  const dated = await Promise.all(source.map(async (page) => ({ page, date: await updated(page) })))
  return dated.sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, config.feed === false ? 0 : config.feed.limit)
}

function rss(items: Array<{ page: RenderedPage; date: Date }>, config: CarvePressConfig, opts: Required<FeedOptions>): string {
  const title = opts.title || config.blog?.title || config.title
  const desc = opts.description || config.blog?.description || config.description || ''
  // The site link has to carry the base: a feed for a project page under
  // /carve-press/ that points at the domain root points at someone else's site.
  const link = absoluteRouteUrl(config.hostname!, config.base, '/')
  const body = items.map(({ page, date }) => {
    const url = absoluteRouteUrl(config.hostname!, config.base, page.searchDoc.route)
    return `    <item><title>${escapeXml(page.searchDoc.title)}</title><link>${escapeXml(url)}</link><guid>${escapeXml(url)}</guid><pubDate>${date.toUTCString()}</pubDate><description>${escapeXml(description(page))}</description></item>`
  }).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>${escapeXml(title)}</title><link>${escapeXml(link)}</link><description>${escapeXml(desc)}</description>\n${body}\n</channel></rss>\n`
}

function atom(items: Array<{ page: RenderedPage; date: Date }>, config: CarvePressConfig, opts: Required<FeedOptions>): string {
  const title = opts.title || config.blog?.title || config.title
  const site = absoluteRouteUrl(config.hostname!, config.base, '/')
  const updatedAt = items[0]?.date ?? new Date()
  const body = items.map(({ page, date }) => {
    const url = absoluteRouteUrl(config.hostname!, config.base, page.searchDoc.route)
    return `  <entry><title>${escapeXml(page.searchDoc.title)}</title><link href="${escapeXml(url)}"/><id>${escapeXml(url)}</id><updated>${date.toISOString()}</updated><summary>${escapeXml(description(page))}</summary></entry>`
  }).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom"><title>${escapeXml(title)}</title><link href="${escapeXml(site)}"/><id>${escapeXml(site)}</id><updated>${updatedAt.toISOString()}</updated>\n${body}\n</feed>\n`
}

export function feed(opts: Required<FeedOptions>): SiteExtension {
  let config: CarvePressConfig | undefined
  return {
    name: 'feed',
    setup(bus) {
      bus.on('buildStarted', (payload) => {
        config = payload.config
        if (config.feed !== false && (config.hostname === undefined || config.hostname === '')) {
          throw new BuildError('feed requires hostname')
        }
      })
      bus.on(
        'buildCompleted',
        async ({ rendered, outDir }) => {
          if (config === undefined || config.feed === false) return
          const siteConfig = config
          const prefixes = localePrefixes(siteConfig)
          const items = await feedPages(rendered, siteConfig)

          // One feed per locale, at <prefix>feed.xml. A single mixed feed
          // subscribes a reader to languages they did not ask for, and the
          // per-page head link points at the feed for that page's locale.
          for (const prefix of prefixes) {
            const localeItems = items.filter(
              ({ page }) => localePrefixFor(page.searchDoc.route, prefixes) === prefix,
            )
            // Written even when empty: every page of that locale advertises this
            // URL in its head, and a link to a file that does not exist is a
            // 404 for anyone who tries to subscribe. It fills itself the moment
            // the locale gets a post.
            const xml =
              opts.type === 'atom'
                ? atom(localeItems, siteConfig, opts)
                : rss(localeItems, siteConfig, opts)
            const outPath = resolve(outDir, prefix.replace(/^\//, ''), opts.filename)
            await mkdir(dirname(outPath), { recursive: true })
            await writeFile(outPath, xml, 'utf8')
          }
        },
        'feed',
      )
    },
  }
}

