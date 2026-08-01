import { readdir, readFile } from 'node:fs/promises'
import { resolve, relative, sep } from 'node:path'
import { routeForPath, routeKey } from './route.js'
import { splitFrontmatter } from './frontmatter.js'
import { BuildError } from '../errors.js'

export interface Page {
  route: string
  /** Absolute path on disk. */
  srcPath: string
  /** Path relative to srcDir, always with forward slashes. */
  relPath: string
  frontmatter: Record<string, unknown>
  /** Body only; frontmatter has been split off. */
  source: string
  bodyStartLine: number
}

const RE_PAGE = /\.(crv|carve)$/

/** Translate a `srcExclude` glob into a matcher. Only `*` and `**` are supported. */
function globToRegExp(glob: string): RegExp {
  // `*` is deliberately absent from the escape class so it survives to the
  // second pass. That pass alternates `**` ahead of `*`, so a two-star segment
  // is never consumed as two single stars - which is why this is one pass with
  // an alternation rather than two sequential replaces needing a placeholder.
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  const body = escaped.replace(/\*\*|\*/g, (match) => (match === '**' ? '.*' : '[^/]*'))
  return new RegExp(`^${body}$`)
}

async function walk(dir: string, base: string, found: string[]): Promise<void> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    // A locked directory would otherwise reach the user as a raw EACCES with a
    // Node-internal stack trace. There is no line or column to report for a
    // directory, so BuildError carries the path in its details instead.
    const reason = error instanceof Error ? error.message : String(error)
    throw new BuildError(`cannot read content directory ${dir}`, [reason])
  }
  for (const entry of entries) {
    const full = resolve(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.')) continue
      await walk(full, base, found)
    } else if (RE_PAGE.test(entry.name)) {
      found.push(relative(base, full).split(sep).join('/'))
    }
  }
}

export async function discoverPages(srcDir: string, srcExclude: string[]): Promise<Page[]> {
  const relPaths: string[] = []
  await walk(srcDir, srcDir, relPaths)
  const excludes = srcExclude.map(globToRegExp)
  // Sorted so build output, route order, and prev/next never depend on the
  // filesystem's readdir order.
  relPaths.sort()

  const pages: Page[] = []
  const seen = new Map<string, string>()
  for (const relPath of relPaths) {
    if (excludes.some((re) => re.test(relPath))) continue
    const route = routeForPath(relPath)
    // Keyed on routeKey, not route: `foo.crv` and `foo/index.crv` yield
    // different routes but the same output file under cleanUrls, so comparing
    // raw routes would let one silently overwrite the other.
    const key = routeKey(route)
    const previous = seen.get(key)
    if (previous !== undefined) {
      throw new BuildError(`duplicate route ${key}`, [
        `${previous} and ${relPath} both resolve to ${key}`,
      ])
    }
    seen.set(key, relPath)
    const srcPath = resolve(srcDir, relPath)
    const raw = await readFile(srcPath, 'utf8')
    const { data, body, bodyStartLine } = splitFrontmatter(raw, relPath)
    pages.push({ route, srcPath, relPath, frontmatter: data, source: body, bodyStartLine })
  }
  return pages
}
