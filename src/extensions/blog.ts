import { resolve } from 'node:path'
import type { SiteExtension } from '../config.js'
import type { Page } from '../content/discover.js'
import { routeKey } from '../content/route.js'
import { SourceError } from '../errors.js'

export interface BlogOptions {
  dir: string
  route?: string
  title?: string
  description?: string
  perPage?: number
  tagsRoute?: string
}

interface BlogPost {
  page: Page
  date: Date
  tags: string[]
  excerpt: string
}

function sourceError(page: Page, key: string): SourceError {
  return new SourceError(page.relPath, 1, 1, `frontmatter: invalid ${key}`)
}

function titleOf(page: Page): string {
  return typeof page.frontmatter.title === 'string' && page.frontmatter.title !== ''
    ? page.frontmatter.title
    : page.relPath
}

function validDate(value: unknown): Date | undefined {
  if (typeof value !== 'string') return undefined
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return undefined
  return new Date(time)
}

function proseExcerpt(source: string): string {
  for (const block of source.split(/\n{2,}/)) {
    const text = block
      .replace(/^#+\s+/gm, '')
      .replace(/!\[[^\]]*]\([^)]*\)/g, '')
      .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
      .replace(/[`*_~]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (text !== '') return text
  }
  return ''
}

function excerptOf(page: Page): string {
  if (typeof page.frontmatter.excerpt === 'string') return page.frontmatter.excerpt
  if (typeof page.frontmatter.description === 'string') return page.frontmatter.description
  return proseExcerpt(page.source)
}

function markdownEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]')
}

function routeJoin(prefix: string, part: string): string {
  return `${prefix.replace(/\/$/, '')}/${part.replace(/^\/+/, '')}`
}

function pageRoute(route: string, page: number): string {
  return page === 1 ? route : routeJoin(route, `page/${page}/`)
}

function tagSlug(tag: string): string {
  return tag
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'tag'
}

function listSource(title: string, description: string, posts: BlogPost[], route: string): string {
  const lines = [`# ${title}`, '']
  if (description !== '') lines.push(description, '')
  for (const post of posts) {
    // A blank line after the heading is load-bearing: Carve folds the lines
    // directly below a heading into it, which ran the title, the date, and the
    // tags together as one oversized run-on line.
    lines.push('{.blog-card}', '::: div', `## [${markdownEscape(titleOf(post.page))}](${post.page.route})`, '')
    lines.push('{.blog-card__meta}', post.date.toISOString().slice(0, 10), '')
    if (post.tags.length > 0) {
      lines.push('{.blog-card__tags}')
      lines.push(
        post.tags
          .map((tag) => `[${markdownEscape(tag)}](${routeJoin(route, `${tagSlug(tag)}/`)})`)
          .join(' '),
      )
      lines.push('')
    }
    if (post.excerpt !== '') lines.push(post.excerpt, '')
    lines.push(`[Read more](${post.page.route})`, '', ':::', '')
  }
  return lines.join('\n')
}

function virtualPage(route: string, relPath: string, title: string, source: string, srcDir: string): Page {
  return {
    route,
    srcPath: resolve(srcDir, relPath),
    relPath,
    frontmatter: { title, layout: 'page', virtual: true },
    source,
    bodyStartLine: 1,
  }
}

export function blog(opts: Required<BlogOptions>): SiteExtension {
  return {
    name: 'blog',
    setup(bus) {
      let srcDir = ''
      bus.on('buildStarted', ({ config }) => {
        srcDir = config.srcDir
      })
      bus.on(
        'contentDiscovered',
        ({ pages }) => {
          const prefix = `${opts.dir.replace(/\/+$/, '')}/`
          const posts = pages
            .filter((page) => page.relPath.startsWith(prefix))
            .map((page): BlogPost => {
              const date = validDate(page.frontmatter.date)
              if (date === undefined) throw sourceError(page, 'date')
              const tagValue = page.frontmatter.tags
              if (tagValue !== undefined && (!Array.isArray(tagValue) || tagValue.some((tag) => typeof tag !== 'string'))) {
                throw sourceError(page, 'tags')
              }
              if (page.frontmatter.layout === undefined) page.frontmatter.layout = 'blog'
              return {
                page,
                date,
                tags: tagValue === undefined ? [] : tagValue,
                excerpt: excerptOf(page),
              }
            })
            .filter((post) => post.page.frontmatter.draft !== true)
            .sort((a, b) => b.date.getTime() - a.date.getTime())

          const existing = new Set(pages.map((page) => routeKey(page.route)))
          const add = (page: Page) => {
            const key = routeKey(page.route)
            if (existing.has(key)) throw new SourceError(page.relPath, 1, 1, `generated blog route collides with ${key}`)
            existing.add(key)
            pages.push(page)
          }

          const perPage = Math.max(1, opts.perPage)
          const pagesNeeded = Math.max(1, Math.ceil(posts.length / perPage))
          for (let page = 1; page <= pagesNeeded; page += 1) {
            const slice = posts.slice((page - 1) * perPage, page * perPage)
            add(virtualPage(pageRoute(opts.route, page), `.carve-press/blog/${page}.crv`, opts.title, listSource(opts.title, opts.description, slice, opts.tagsRoute), srcDir))
          }

          const byTag = new Map<string, BlogPost[]>()
          for (const post of posts) for (const tag of post.tags) byTag.set(tag, [...(byTag.get(tag) ?? []), post])
          const tags = [...byTag.keys()].sort((a, b) => a.localeCompare(b))
          add(virtualPage(opts.tagsRoute, '.carve-press/blog/tags.crv', 'Tags', [
            '# Tags',
            '',
            ...tags.map((tag) => `- [${markdownEscape(tag)}](${routeJoin(opts.tagsRoute, `${tagSlug(tag)}/`)})`),
            '',
          ].join('\n'), srcDir))
          for (const tag of tags) {
            add(virtualPage(routeJoin(opts.tagsRoute, `${tagSlug(tag)}/`), `.carve-press/blog/tags/${tagSlug(tag)}.crv`, tag, listSource(tag, '', byTag.get(tag) ?? [], opts.tagsRoute), srcDir))
          }
        },
        'blog',
      )
    },
  }
}
