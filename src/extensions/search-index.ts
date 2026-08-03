import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { SiteExtension } from '../config.js'
import type { RenderedPage } from '../render/page.js'
import { publicRenderedPages } from './derived.js'

export interface SearchIndexOptions {
  filename?: string
  exclude?: string[]
}

export interface SearchIndexRecord {
  id: string
  route: string
  title: string
  heading: string
  slug: string
  text: string
}

export interface SearchIndexPayload {
  version: 1
  records: SearchIndexRecord[]
}

function normalizedOptions(opts: SearchIndexOptions = {}): Required<SearchIndexOptions> {
  return {
    filename: opts.filename ?? 'search-index.json',
    exclude: opts.exclude ?? [],
  }
}

/**
 * One record for the page, then one per section.
 *
 * Sections alone left whole pages unfindable: a record exists only for a
 * heading inside the outline levels, so a page written without an `##` produced
 * nothing at all, and text above a page's first heading belonged to no section
 * on any page. Both failed silently - search simply did not know those pages
 * existed.
 */
function recordsFromPage(page: RenderedPage): SearchIndexRecord[] {
  const doc = page.searchDoc
  return [
    {
      id: `${doc.route}#:page`,
      route: doc.route,
      title: doc.title,
      heading: doc.title,
      slug: '',
      text: doc.text,
    },
    ...doc.sections.map((section, index) => ({
      id: `${doc.route}#${section.slug}:${index}`,
      route: doc.route,
      title: doc.title,
      heading: section.heading,
      slug: section.slug,
      text: section.text,
    })),
  ]
}

export function searchIndex(opts: SearchIndexOptions = {}): SiteExtension {
  const options = normalizedOptions(opts)
  const excluded = new Set(options.exclude)

  return {
    name: 'search-index',
    setup(bus) {
      bus.on(
        'buildCompleted',
        async ({ rendered, outDir }) => {
          const records = publicRenderedPages(rendered)
            .filter((page) => !excluded.has(page.searchDoc.route))
            .flatMap(recordsFromPage)
          const payload: SearchIndexPayload = { version: 1, records }
          const outPath = resolve(outDir, 'assets', options.filename)
          await mkdir(dirname(outPath), { recursive: true })
          await writeFile(outPath, `${JSON.stringify(payload)}\n`, 'utf8')
        },
        'search-index',
      )
    },
  }
}
