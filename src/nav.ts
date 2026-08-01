import type { SidebarGroup, SidebarItem } from './config.js'

export interface FlatLink {
  text: string
  link: string
}

/**
 * Path-keyed sidebar lookup. The longest matching key wins, so a `/case-study/`
 * sidebar overrides the `/` one for routes beneath it.
 */
export function resolveSidebar(
  route: string,
  sidebar: Record<string, SidebarGroup[]>,
): SidebarGroup[] {
  let best: string | undefined
  for (const key of Object.keys(sidebar)) {
    if (!route.startsWith(key)) continue
    if (best === undefined || key.length > best.length) best = key
  }
  return best === undefined ? [] : sidebar[best]!
}

function collect(items: SidebarItem[], out: FlatLink[]): void {
  for (const item of items) {
    if (item.link !== undefined) out.push({ text: item.text, link: item.link })
    if (item.items !== undefined) collect(item.items, out)
  }
}

/** Depth-first reading order, which is what prev/next follows. */
export function flattenSidebar(groups: SidebarGroup[]): FlatLink[] {
  const out: FlatLink[] = []
  for (const group of groups) collect(group.items, out)
  return out
}

export function resolvePrevNext(
  route: string,
  groups: SidebarGroup[],
): { prev?: FlatLink; next?: FlatLink } {
  const flat = flattenSidebar(groups)
  const index = flat.findIndex((item) => item.link === route)
  if (index === -1) return {}
  return { prev: flat[index - 1], next: flat[index + 1] }
}
