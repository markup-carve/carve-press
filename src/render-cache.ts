import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, relative, resolve } from 'node:path'
import type { CarvePressConfig } from './config.js'
import type { Page } from './content/discover.js'
import type { RenderContext, RenderedPage } from './render/page.js'

const require = createRequire(import.meta.url)
const defaultThemePath = require.resolve('../theme/default.css')
const packageJsonPath = require.resolve('../package.json')

export interface RenderStats {
  rendered: number
  reused: number
}

export interface RenderCache {
  stats: RenderStats
  render(page: Page, ctx: RenderContext, render: () => RenderedPage): RenderedPage
}

export function sha256(text: string | Buffer): string {
  return createHash('sha256').update(text).digest('hex')
}

export function fileHashOrMissing(path: string): string {
  try {
    return sha256(readFileSync(path))
  } catch {
    return 'missing'
  }
}

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => typeof item !== 'function' && item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`
}

/**
 * Extension code is not data, so its source text stands in for it. A change
 * inside a helper the hook imports from another file is not seen; that is
 * what `--no-cache` is for.
 */
function codeOf(values: object[]): string[] {
  return values.map((value) =>
    Object.entries(value)
      .map(([key, item]) => `${key}=${typeof item === 'function' ? String(item) : stableJson(item)}`)
      .sort()
      .join('\n'),
  )
}

function serializableConfig(config: CarvePressConfig): unknown {
  return {
    ...config,
    carve: {
      ...config.carve,
      profile: config.carve.profile === undefined ? undefined : config.carve.profile.constructor.name,
      extensions: codeOf(config.carve.extensions),
    },
    extensions: codeOf(config.extensions),
    layouts: Object.keys(config.layouts).sort(),
  }
}

function findPackageJson(packageName: string): string | undefined {
  let dir = dirname(packageJsonPath)
  while (true) {
    const candidate = resolve(dir, 'node_modules', ...packageName.split('/'), 'package.json')
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

function packageVersion(packageName: string): string {
  const path = packageName === '@markup-carve/carve-press' ? packageJsonPath : findPackageJson(packageName)
  if (path === undefined) return 'unknown'
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { version?: unknown }
    return typeof parsed.version === 'string' ? parsed.version : 'unknown'
  } catch {
    return 'unknown'
  }
}

const CONFIG_NAMES = ['carve-press.config.ts', 'carve-press.config.js', 'carve-press.config.mjs']

/** Everything outside the page that a render reads, folded into one key. */
export function globalFingerprint(root: string, config: CarvePressConfig): string {
  const themePaths = [
    config.theme.css === undefined ? defaultThemePath : resolve(root, config.theme.css),
    ...(config.theme.extraCss ?? []).map((path) => resolve(root, path)),
  ]
  return stableJson({
    config: serializableConfig(config),
    configFiles: CONFIG_NAMES.map((name) => fileHashOrMissing(resolve(root, name))),
    theme: themePaths.map((path) => ({ path, hash: fileHashOrMissing(path) })),
    versions: {
      engine: packageVersion('@markup-carve/carve'),
      grammars: packageVersion('@markup-carve/carve-grammars'),
      shiki: packageVersion('shiki'),
      carvePress: packageVersion('@markup-carve/carve-press'),
    },
  })
}

export function pageSourceHash(page: Page): string {
  return sha256(page.rawSource ?? stableJson({ frontmatter: page.frontmatter, source: page.source }))
}

/** Included files and probed images: the files a render read besides the page. */
export function dependencyHashes(rendered: RenderedPage): Record<string, string> {
  const paths = [...rendered.includeFiles.map((file) => file.path), ...(rendered.assetFiles ?? [])]
  return Object.fromEntries(paths.map((path) => [path, fileHashOrMissing(path)]))
}

export function dependenciesUnchanged(hashes: Record<string, string>): boolean {
  return Object.entries(hashes).every(([path, hash]) => fileHashOrMissing(path) === hash)
}

type StoredRender = Omit<RenderedPage, 'page'>

interface StoredEntry {
  route: string
  sourceHash: string
  dependencies: Record<string, string>
  rendered: StoredRender
}

interface StoredCache {
  format: number
  global: string
  entries: Record<string, StoredEntry>
}

const FORMAT = 1

/**
 * Page renders kept between `build` runs. Only the render is cached: layout,
 * nav, sidebars, search, feeds and every validation still run over all pages
 * on each build, so nothing that spans pages can go stale here.
 */
export class PersistentRenderCache implements RenderCache {
  readonly stats: RenderStats = { rendered: 0, reused: 0 }
  private readonly next: Record<string, StoredEntry> = {}

  private constructor(
    private readonly file: string,
    private readonly root: string,
    private readonly global: string,
    private readonly previous: Record<string, StoredEntry>,
  ) {}

  static async load(opts: { file: string; root: string; global: string }): Promise<PersistentRenderCache> {
    let previous: Record<string, StoredEntry> = {}
    try {
      const stored = JSON.parse(await readFile(opts.file, 'utf8')) as StoredCache
      if (stored.format === FORMAT && stored.global === opts.global) previous = stored.entries
    } catch {
      // Missing or unreadable: start empty. A cache is never a reason to fail.
    }
    return new PersistentRenderCache(opts.file, opts.root, opts.global, previous)
  }

  render(page: Page, _ctx: RenderContext, render: () => RenderedPage): RenderedPage {
    const key = relative(this.root, page.srcPath)
    const sourceHash = pageSourceHash(page)
    const entry = this.previous[key]
    if (
      entry !== undefined &&
      entry.route === page.route &&
      entry.sourceHash === sourceHash &&
      dependenciesUnchanged(entry.dependencies)
    ) {
      this.stats.reused += 1
      this.next[key] = entry
      return { ...structuredClone(entry.rendered), page }
    }
    const rendered = render()
    this.stats.rendered += 1
    const { page: _page, ...stored } = rendered
    this.next[key] = {
      route: page.route,
      sourceHash,
      dependencies: dependencyHashes(rendered),
      rendered: structuredClone(stored),
    }
    return rendered
  }

  /** Writes only the pages of this build, so deleted pages drop out. */
  async save(): Promise<void> {
    const stored: StoredCache = { format: FORMAT, global: this.global, entries: this.next }
    await mkdir(dirname(this.file), { recursive: true })
    await writeFile(this.file, JSON.stringify(stored), 'utf8')
  }
}
