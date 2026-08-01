import { lintCarve } from '@markup-carve/carve'
import type { NavItem, SidebarGroup, SidebarItem, ThemeConfig } from './config.js'
import type { Page } from './content/discover.js'
import { BuildError } from './errors.js'
import type { RenderedPage } from './render/page.js'

const RE_HREF = /<a\b[^>]*\bhref="([^"]*)"/g

class ValidationError extends BuildError {
  constructor(
    private readonly summary: string,
    details: string[],
  ) {
    super(`${summary}\n${details.join('\n')}`, details)
  }

  override format(): string {
    return `${this.summary}\n${this.details.map((d) => `  ${d}`).join('\n')}`
  }
}

/** Only site-internal, non-fragment links are checkable. */
function isInternal(href: string): boolean {
  if (href === '') return false
  if (href.startsWith('#')) return false
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return false
  if (href.startsWith('//')) return false
  return href.startsWith('/')
}

function routeWithoutHashOrQuery(href: string): string {
  return href.split('#')[0]!.split('?')[0]!
}

/**
 * Every dead link is reported in one error. One-at-a-time reporting turns a
 * 42-page migration into 42 build cycles.
 */
export function validateLinks(
  pages: RenderedPage[],
  routes: Set<string>,
  ignore: boolean,
): void {
  if (ignore) return
  const dead: string[] = []
  for (const rendered of pages) {
    for (const match of rendered.html.matchAll(RE_HREF)) {
      const href = match[1]!
      if (!isInternal(href)) continue
      const route = routeWithoutHashOrQuery(href)
      if (!routes.has(route)) dead.push(`${rendered.page.relPath}: ${href}`)
    }
  }
  if (dead.length > 0) {
    throw new ValidationError(`${dead.length} dead internal link(s)`, dead)
  }
}

function walkNav(items: NavItem[], out: string[]): void {
  for (const item of items) {
    if (item.link !== undefined) out.push(item.link)
    if (item.items !== undefined) walkNav(item.items, out)
  }
}

function walkSidebar(items: SidebarItem[], out: string[]): void {
  for (const item of items) {
    if (item.link !== undefined) out.push(item.link)
    if (item.items !== undefined) walkSidebar(item.items, out)
  }
}

/**
 * A nav or sidebar entry pointing nowhere is invisible until a reader clicks it.
 * VitePress tolerates it silently; a reference site should not.
 */
export function validateNav(theme: ThemeConfig, routes: Set<string>): void {
  const bad: string[] = []
  const warnings: string[] = []

  const navLinks: string[] = []
  walkNav(theme.nav, navLinks)
  for (const link of navLinks) {
    if (link.startsWith('/') && !routes.has(link)) bad.push(`nav: ${link}`)
  }

  for (const [key, groups] of Object.entries(theme.sidebar)) {
    if (key !== '/' && !key.endsWith('/')) {
      warnings.push(`sidebar "${key}": key does not end in /`)
    }

    const links: string[] = []
    for (const group of groups as SidebarGroup[]) walkSidebar(group.items, links)

    const seen = new Set<string>()
    const duplicates = new Set<string>()
    for (const link of links) {
      if (link.startsWith('/') && !routes.has(link)) bad.push(`sidebar "${key}": ${link}`)
      if (seen.has(link)) duplicates.add(link)
      seen.add(link)
    }
    for (const link of duplicates) {
      bad.push(`sidebar "${key}": duplicate link ${link}`)
    }
  }

  // A non-slash sidebar key is legal and may be deliberate, so it warns rather
  // than failing the build - unlike the entries above, which have no correct
  // reading. Warnings print even when an error follows, or fixing the error
  // would only reveal them on the next run.
  for (const warning of warnings) {
    console.warn(`carve-press: ${warning}`)
  }

  if (bad.length > 0) {
    throw new ValidationError(`${bad.length} navigation validation failure(s)`, bad)
  }
}

/**
 * Every lint warning names a construct that renders as something other than
 * what it says - a crossref that becomes literal text, an unresolved
 * reference. Those are exactly the silent degradations a docs build must not
 * ship, so a warning is fatal here.
 */
export function validateCrossrefs(pages: Page[]): void {
  const bad: string[] = []
  for (const page of pages) {
    for (const warning of lintCarve(page.source)) {
      // lintCarve lines are body-relative; shift them back to the source file.
      const line = warning.line + page.bodyStartLine - 1
      bad.push(`${page.relPath}:${line}:${warning.column} ${warning.rule} - ${warning.message}`)
    }
  }
  if (bad.length > 0) {
    throw new ValidationError(`${bad.length} lint failure(s)`, bad)
  }
}
