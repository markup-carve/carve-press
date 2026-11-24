import { readFileSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { lint, positionOf, type Diagnostic } from '@markup-carve/carve'
import { fileSystemResolver } from '@markup-carve/carve/node'
import type { NavItem, SidebarConfigGroup, SidebarItem, ThemeConfig } from './config.js'
import type { Page } from './content/discover.js'
import { BuildError } from './errors.js'
import type { RenderedPage } from './render/page.js'

// 0.1 refused a continuation marker and failed the build; 0.2 reports it as
// deprecated, but the marker still renders as text, so it stays fatal here.
const STILL_FATAL = new Set(['deprecated-continuation-marker'])
// 0.2 lint runs the migration rules only on request (C2-W-156), so turn these on.
const FATAL_RULES = Object.fromEntries([...STILL_FATAL].map((rule) => [rule, 'on' as const]))

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

function stripBase(href: string, base: string): string {
  if (base === '/' || !href.startsWith(base)) return href
  return `/${href.slice(base.length)}`
}

/**
 * Every dead link is reported in one error. One-at-a-time reporting turns a
 * 42-page migration into 42 build cycles.
 */
export function validateLinks(
  pages: RenderedPage[],
  routes: Set<string>,
  ignore: boolean,
  base = '/',
): void {
  if (ignore) return
  const dead: string[] = []
  for (const rendered of pages) {
    for (const match of rendered.html.matchAll(RE_HREF)) {
      const href = match[1]!
      if (!isInternal(href)) continue
      const authoredHref = stripBase(href, base)
      const route = routeWithoutHashOrQuery(authoredHref)
      if (!routes.has(route)) dead.push(`${rendered.page.relPath}: ${authoredHref}`)
    }
  }
  if (dead.length > 0) {
    throw new ValidationError(`${dead.length} dead internal link(s)`, dead)
  }
}

/**
 * A frontmatter prev/next override is injected into the footer after the page
 * HTML was validated, so it needs its own check. Without it, an override is the
 * one internal link on the site that can point nowhere and still build.
 */
export function validatePageNavOverrides(
  overrides: Array<{ relPath: string; links: Array<string | undefined> }>,
  routes: Set<string>,
  ignore: boolean,
): void {
  if (ignore) return
  const dead: string[] = []
  for (const { relPath, links } of overrides) {
    for (const link of links) {
      if (link === undefined || !isInternal(link)) continue
      if (!routes.has(routeWithoutHashOrQuery(link))) dead.push(`${relPath}: ${link}`)
    }
  }
  if (dead.length > 0) {
    throw new ValidationError(`${dead.length} dead frontmatter prev/next link(s)`, dead)
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

function isStaticSidebarGroup(group: SidebarConfigGroup): group is SidebarConfigGroup & { items: SidebarItem[] } {
  return Array.isArray((group as { items?: unknown }).items)
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
    if (link.startsWith('/') && !routes.has(link)) bad.push(`nav entries point at no route: ${link}`)
  }

  for (const [key, groups] of Object.entries(theme.sidebar)) {
    if (key !== '/' && !key.endsWith('/')) {
      warnings.push(`sidebar "${key}": key does not end in /`)
    }

    const links: string[] = []
    for (const group of groups) {
      if (isStaticSidebarGroup(group)) walkSidebar(group.items, links)
    }

    const seen = new Set<string>()
    const duplicates = new Set<string>()
    for (const link of links) {
      if (link.startsWith('/') && !routes.has(link)) {
        bad.push(`sidebar "${key}" entries point at no route: ${link}`)
      }
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

/** 1-based line and column of a diagnostic, or 1:1 when it carries no range. */
function locate(text: string | Uint8Array | undefined, diagnostic: Diagnostic): { line: number; column: number } {
  if (text === undefined || diagnostic.range === undefined) return { line: 1, column: 1 }
  return positionOf(text, diagnostic.range.startOffset)
}

function readIncluded(root: string, file: string, cache: Map<string, Uint8Array | undefined>): Uint8Array | undefined {
  if (!cache.has(file)) {
    let text: Uint8Array | undefined
    try {
      text = readFileSync(resolve(root, file))
    } catch {
      text = undefined
    }
    cache.set(file, text)
  }
  return cache.get(file)
}

/**
 * Every lint warning names a construct that renders as something other than
 * what it says - a crossref that becomes literal text, an unresolved
 * reference. Those are exactly the silent degradations a docs build must not
 * ship, so a warning is fatal here. Hints (a non-canonical spelling) are
 * skipped, and a deprecated spelling that still renders as written is printed
 * but does not fail the build. With an include root, included files are
 * linted too, at their own coordinates.
 */
export function lintFailures(pages: Page[], includeRoot?: string): string[] {
  const bad: string[] = []
  const included = new Map<string, Uint8Array | undefined>()
  for (const page of pages) {
    const includes =
      includeRoot === undefined
        ? undefined
        : {
            resolver: fileSystemResolver(includeRoot),
            file: relative(includeRoot, page.srcPath).split(sep).join('/'),
          }
    for (const diagnostic of lint(page.source, includes === undefined ? { rules: FATAL_RULES } : { includes, rules: FATAL_RULES })) {
      if (diagnostic.severity === 'hint') continue
      // Without an include root nothing is expanded on purpose, as with the 0.1 engine.
      if (includes === undefined && diagnostic.code === 'include-no-resolver') continue
      let entry: string
      if (diagnostic.file !== undefined) {
        const rel = diagnostic.file
        const outside = rel.startsWith('..') || isAbsolute(rel)
        const file = outside ? '[outside-root]' : rel
        const text = outside || includeRoot === undefined ? undefined : readIncluded(includeRoot, rel, included)
        const { line, column } = locate(text, diagnostic)
        entry = `${file}:${line}:${column} ${diagnostic.code} - ${diagnostic.message} (included from ${page.relPath})`
      } else {
        const { line: bodyLine, column } = locate(page.source, diagnostic)
        // Lint positions are body-relative; shift them back to the source file.
        const line = bodyLine + page.bodyStartLine - 1
        entry = `${page.relPath}:${line}:${column} ${diagnostic.code} - ${diagnostic.message}`
      }
      if (diagnostic.code.startsWith('deprecated-') && !STILL_FATAL.has(diagnostic.code)) {
        console.warn(`carve-press: ${entry}`)
        continue
      }
      bad.push(entry)
    }
  }
  return bad
}

export function validateCrossrefs(pages: Page[], includeRoot?: string): void {
  const bad = lintFailures(pages, includeRoot)
  if (bad.length > 0) {
    throw new ValidationError(`${bad.length} lint failure(s)`, bad)
  }
}
