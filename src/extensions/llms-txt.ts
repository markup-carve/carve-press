import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { CarvePressConfig, SiteExtension } from '../config.js'
import { publicRenderedPages } from './derived.js'
import { routeUrl } from './url.js'

export interface LlmsTxtOptions {
  filename?: string
  title?: string
  summary?: string
  exclude?: string[]
}

function normalizedOptions(opts: LlmsTxtOptions = {}): Required<LlmsTxtOptions> {
  return {
    filename: opts.filename ?? 'llms.txt',
    title: opts.title ?? '',
    summary: opts.summary ?? '',
    exclude: opts.exclude ?? [],
  }
}

function markdownText(value: string): string {
  return value.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim()
}

function markdownLinkText(value: string): string {
  return markdownText(value).replace(/\\/g, '\\\\').replace(/\]/g, '\\]')
}

function markdownUrl(value: string): string {
  return value.replace(/\)/g, '%29').replace(/\s/g, '%20')
}

function pageDescription(frontmatter: Record<string, unknown>): string {
  return typeof frontmatter.description === 'string' ? frontmatter.description : ''
}

export function llmsTxt(opts: LlmsTxtOptions = {}): SiteExtension {
  const options = normalizedOptions(opts)
  const excluded = new Set(options.exclude)
  let config: CarvePressConfig | undefined

  return {
    name: 'llms-txt',
    setup(bus) {
      bus.on('buildStarted', (payload) => {
        config = payload.config
      })
      bus.on(
        'buildCompleted',
        async ({ rendered, outDir }) => {
          if (config === undefined) return
          const title = options.title === '' ? config.title : options.title
          const summary = options.summary === '' ? config.description : options.summary
          const lines = [`# ${markdownText(title)}`, '']
          if (summary !== undefined && summary !== '') {
            lines.push(`> ${markdownText(summary)}`, '')
          }
          for (const page of publicRenderedPages(rendered).filter((item) => !excluded.has(item.searchDoc.route))) {
            const url = routeUrl(config.base, page.searchDoc.route)
            const description = markdownText(pageDescription(page.page.frontmatter))
            const suffix = description === '' ? '' : `: ${description}`
            lines.push(`- [${markdownLinkText(page.searchDoc.title)}](${markdownUrl(url)})${suffix}`)
          }
          const outPath = resolve(outDir, options.filename)
          await mkdir(dirname(outPath), { recursive: true })
          await writeFile(outPath, `${lines.join('\n')}\n`, 'utf8')
        },
        'llms-txt',
      )
    },
  }
}
