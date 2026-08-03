import type { CarvePressConfig } from './config.js'
import { resolveByPrefix } from './nav.js'

/**
 * Route-prefix helpers shared by the derived-output extensions.
 *
 * The theme resolves a locale per page already; search, the feed, and the
 * sitemap need the same answer without going through a layout, and all three
 * were previously blind to locales - one index, one feed, and a sitemap with no
 * alternates, so a German reader searching got English results.
 */
export function localePrefixes(config: CarvePressConfig): string[] {
  const keys = Object.keys(config.locales)
  return keys.length === 0 ? ['/'] : keys
}

/** The configured prefix a route belongs to, or `/` when none is configured. */
export function localePrefixFor(route: string, prefixes: string[]): string {
  const byPrefix = Object.fromEntries(prefixes.map((prefix) => [prefix, prefix]))
  return resolveByPrefix(route, byPrefix) ?? '/'
}

/** Strip the locale prefix, giving the route as the default locale would spell it. */
export function withoutLocale(route: string, prefix: string): string {
  if (prefix === '/' || !route.startsWith(prefix)) return route
  return `/${route.slice(prefix.length)}`
}

/** Re-apply a locale prefix to a prefix-free route. */
export function withLocale(route: string, prefix: string): string {
  if (prefix === '/') return route
  return `${prefix.replace(/\/$/, '')}${route}`
}

/**
 * The same page in every locale that actually has it, keyed by prefix. A
 * translation that was never written must not be advertised.
 */
export function translationsOf(
  route: string,
  prefixes: string[],
  routes: Set<string>,
): Array<{ prefix: string; route: string }> {
  const bare = withoutLocale(route, localePrefixFor(route, prefixes))
  return prefixes
    .map((prefix) => ({ prefix, route: withLocale(bare, prefix) }))
    .filter((candidate) => routes.has(candidate.route))
}
