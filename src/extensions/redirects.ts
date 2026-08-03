import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { CarvePressConfig, SiteExtension } from '../config.js'
import type { Page } from '../content/discover.js'
import { outPathForRoute, routeKey } from '../content/route.js'
import { BuildError, SourceError } from '../errors.js'
import type { RedirectEntry } from '../events.js'
import { escapeAttr, escapeText, withBase } from '../layout/shell.js'

function isAbsoluteUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//')
}

function normalizeSource(route: string): string {
  return route.startsWith('/') ? route : `/${route}`
}

function html(source: string, target: string, config: CarvePressConfig): string {
  const href = isAbsoluteUrl(target) ? target : withBase(config.base, target)
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta http-equiv="refresh" content="0; url=${escapeAttr(href)}">
    <link rel="canonical" href="${escapeAttr(href)}">
    <title>Redirecting</title>
  </head>
  <body>
    <p>Redirecting from ${escapeText(source)} to <a href="${escapeAttr(href)}">${escapeText(href)}</a>.</p>
  </body>
</html>
`
}

/**
 * Sources come from config, not from discovered files, so nothing has already
 * vetted them. A `..` segment survives `outPathForRoute` and would write the
 * redirect stub outside the output directory.
 */
function isSiteRoute(source: string): boolean {
  return source.startsWith('/') && !source.split('/').includes('..')
}

function sourceError(page: Page, key: string): SourceError {
  return new SourceError(page.relPath, 1, 1, `frontmatter: invalid ${key}`)
}

function redirectFromEntries(page: Page): string[] {
  const value = page.frontmatter.redirectFrom
  if (value === undefined || page.frontmatter.draft === true) return []
  if (typeof value === 'string') return [value]
  if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) return value
  throw sourceError(page, 'redirectFrom')
}

function configEntries(entries: Record<string, string>): RedirectEntry[] {
  return Object.entries(entries).map(([source, target]) => ({
    source: normalizeSource(source),
    target,
    claimant: `config redirects["${source}"]`,
  }))
}

function pageEntries(pages: Page[]): RedirectEntry[] {
  return pages.flatMap((page) =>
    redirectFromEntries(page).map((source) => ({
      source,
      target: page.route,
      claimant: `${page.relPath} redirectFrom`,
    })),
  )
}

/**
 * `'/old/*': '/new/*'` expands against the routes that actually exist, one stub
 * per page, because a static host cannot match a pattern at request time. A
 * catch-all for paths nobody can enumerate is not expressible here; the
 * `_redirects` line keeps its splat for hosts that do understand one.
 */
function expandWildcards(entries: RedirectEntry[], pages: Page[]): RedirectEntry[] {
  const out: RedirectEntry[] = []
  for (const entry of entries) {
    if (!entry.source.endsWith('/*')) {
      out.push(entry)
      continue
    }
    if (!entry.target.endsWith('/*') || isAbsoluteUrl(entry.target)) {
      throw new BuildError(
        `redirect source ${entry.source} is a prefix pattern, so its target must be one too`,
        [`${entry.claimant} maps ${entry.source} to ${entry.target}`],
      )
    }
    const sourcePrefix = entry.source.slice(0, -1)
    const targetPrefix = entry.target.slice(0, -1)
    const matched = pages
      .map((page) => page.route)
      .filter((route) => route.startsWith(targetPrefix) && route !== targetPrefix)
    if (matched.length === 0) {
      throw new BuildError(
        `redirect target ${entry.target} matches no pages`,
        [`${entry.claimant} would emit nothing`],
      )
    }
    for (const route of matched) {
      out.push({
        source: `${sourcePrefix}${route.slice(targetPrefix.length)}`,
        target: route,
        claimant: `${entry.claimant} via ${entry.source}`,
      })
    }
  }
  return out
}

function validateRedirects(entries: RedirectEntry[], pages: Page[]): void {
  const routes = new Set(pages.map((page) => routeKey(page.route)))
  const seen = new Map<string, RedirectEntry>()
  for (const entry of entries) {
    if (!isSiteRoute(entry.source)) {
      throw new BuildError(
        `redirect source ${entry.source} is not a site route`,
        ['a source must start with / and must not contain ".." segments'],
      )
    }
    const sourceKey = routeKey(entry.source)
    const previous = seen.get(sourceKey)
    if (previous !== undefined) {
      throw new BuildError(
        `redirect source ${entry.source} is claimed by ${previous.claimant} and ${entry.claimant}`,
        [`${previous.claimant} and ${entry.claimant} both claim ${entry.source}`],
      )
    }
    seen.set(sourceKey, entry)
    if (routes.has(sourceKey)) throw new BuildError(`redirect source ${entry.source} collides with a page`)
    if (!isAbsoluteUrl(entry.target) && !routes.has(routeKey(entry.target))) {
      throw new BuildError(`redirect target ${entry.target} does not resolve to a page`)
    }
  }
}

export function redirects(entries: Record<string, string>): SiteExtension {
  let config: CarvePressConfig | undefined
  let collected: RedirectEntry[] = []
  let hostLines: string[] = []
  const configured = configEntries(entries)
  return {
    name: 'redirects',
    setup(bus) {
      bus.on('buildStarted', (payload) => {
        config = payload.config
      })
      bus.on(
        'redirectsCollected',
        (payload) => {
          const declared = [...configured, ...pageEntries(payload.pages)]
          collected = expandWildcards(declared, payload.pages)
          validateRedirects(collected, payload.pages)
          // The host file keeps the pattern rather than the expansion: a host
          // that understands a splat should get one line, not five hundred.
          hostLines = declared.map((entry) => `${entry.source} ${entry.target} 301`)
          payload.redirects.push(...collected)
        },
        'redirects',
      )
      bus.on(
        'buildCompleted',
        async ({ outDir }) => {
          if (config === undefined) return
          if (collected.length === 0) return
          for (const { source, target } of collected) {
            const outPath = resolve(outDir, outPathForRoute(source, config.cleanUrls))
            await mkdir(dirname(outPath), { recursive: true })
            await writeFile(outPath, html(source, target, config), 'utf8')
          }
          await writeFile(resolve(outDir, '_redirects'), `${hostLines.join('\n')}\n`, 'utf8')
        },
        'redirects',
      )
    },
  }
}
