const RE_EXT = /\.(crv|carve)$/

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
