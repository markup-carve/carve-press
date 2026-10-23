import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { carveToCarve } from '@markup-carve/carve'
import { loadConfig } from './build.js'
import { resolveConfig } from './config.js'
import { BuildError } from './errors.js'

export interface FormatOptions {
  root: string
  /** Files or directories, relative to `root`. Empty means the whole `srcDir`. */
  paths?: string[]
  /** Report files that would change instead of rewriting them. */
  check?: boolean
  /** Pad table columns to a shared display width (engine `alignTables`). */
  alignTables?: boolean
}

export interface FormatResult {
  /** Every file looked at, relative to `root` with forward slashes. */
  files: string[]
  /** Files that are not canonical: rewritten, or with `check`, left as they are. */
  changed: string[]
  /** Files the formatter refused, with the reason. */
  errors: string[]
}

async function collect(dir: string, out: string[]): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      await collect(full, out)
    } else if (entry.name.endsWith('.crv')) {
      out.push(full)
    }
  }
}

async function targets(root: string, paths: string[]): Promise<string[]> {
  const found: string[] = []
  for (const path of paths) {
    const full = resolve(root, path)
    let info
    try {
      info = await stat(full)
    } catch {
      throw new BuildError(`fmt: no such file or directory: ${path}`)
    }
    if (info.isDirectory()) await collect(full, found)
    else if (full.endsWith('.crv')) found.push(full)
    else throw new BuildError(`fmt: not a .crv file: ${path}`)
  }
  return [...new Set(found)].sort()
}

/**
 * Formats Carve sources with the engine's canonical writer. Every `.crv` under
 * `srcDir` is a target, including files `srcExclude` keeps out of routing:
 * an included snippet is still Carve source.
 */
export async function formatSources(opts: FormatOptions): Promise<FormatResult> {
  let paths = opts.paths ?? []
  if (paths.length === 0) {
    const config = resolveConfig(await loadConfig(opts.root), opts.root)
    paths = [config.srcDir]
  }
  const result: FormatResult = { files: [], changed: [], errors: [] }
  for (const file of await targets(opts.root, paths)) {
    const rel = relative(opts.root, file).split(sep).join('/')
    result.files.push(rel)
    const source = await readFile(file, 'utf8')
    let formatted: string
    try {
      formatted = carveToCarve(source, { alignTables: opts.alignTables === true })
    } catch (error) {
      result.errors.push(`${rel}: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    if (formatted === source) continue
    result.changed.push(rel)
    if (opts.check !== true) await writeFile(file, formatted, 'utf8')
  }
  return result
}
