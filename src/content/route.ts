const RE_EXT = /\.crv$/

/** Map a content-relative file path to its route. Routes always start with `/`. */
export function routeForPath(relPath: string): string {
  const normalized = relPath.replace(/\\/g, '/').replace(/^[./]+/, '')
  const withoutExt = normalized.replace(RE_EXT, '')
  if (withoutExt === 'index') return '/'
  if (withoutExt.endsWith('/index')) return `/${withoutExt.slice(0, -'index'.length)}`
  return `/${withoutExt}`
}

/** Map a route to its output file path, relative to outDir. */
export function outPathForRoute(route: string, cleanUrls: boolean): string {
  const trimmed = route.replace(/^\//, '')
  if (trimmed === '' || trimmed.endsWith('/')) return `${trimmed}index.html`
  return cleanUrls ? `${trimmed}/index.html` : `${trimmed}.html`
}

/**
 * Collapse a directory route to its canonical key: `/foo/` and `/foo` name the
 * same page under cleanUrls and write the same output file, so duplicate
 * detection must compare these, not raw routes. The site root stays `/`.
 */
export function routeKey(route: string): string {
  return route === '/' ? '/' : route.replace(/\/$/, '')
}

/**
 * Publish a page at a route that does not follow its path. A source tree
 * organized for editing (`packages/a/docs/index.crv`) rarely matches the URL
 * tree a reader should see (`/a/`).
 *
 * A key is a content-relative source path; a trailing `/*` on both sides moves
 * a whole directory. Patterns are matched longest-first, so a specific entry
 * beats the prefix it sits under regardless of config order.
 */
export function rewriteRoute(relPath: string, rewrites: Record<string, string>): string | undefined {
  const normalized = relPath.replace(/\\/g, '/')
  const exact = rewrites[normalized]
  if (exact !== undefined) return normalizeRewriteTarget(exact)

  const patterns = Object.keys(rewrites)
    .filter((key) => key.endsWith('/*'))
    .sort((a, b) => b.length - a.length)
  for (const key of patterns) {
    const prefix = key.slice(0, -1)
    if (!normalized.startsWith(prefix)) continue
    const target = rewrites[key]!
    if (!target.endsWith('/*')) return normalizeRewriteTarget(target)
    return normalizeRewriteTarget(`${target.slice(0, -1)}${normalized.slice(prefix.length)}`)
  }
  return undefined
}

function normalizeRewriteTarget(target: string): string {
  const withSlash = target.startsWith('/') ? target : `/${target}`
  return routeForPath(withSlash.replace(/^\//, ''))
}
