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

function recordsFromPage(page: RenderedPage): SearchIndexRecord[] {
  return page.searchDoc.sections.map((section, index) => ({
    id: `${page.searchDoc.route}#${section.slug}:${index}`,
    route: page.searchDoc.route,
    title: page.searchDoc.title,
    heading: section.heading,
    slug: section.slug,
    text: section.text,
  }))
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
