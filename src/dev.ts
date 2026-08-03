import { createHash } from 'node:crypto'
import { existsSync, readFileSync, type FSWatcher, promises as fs, watch } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, resolve } from 'node:path'
import type { ServerResponse } from 'node:http'
import { buildSite, loadConfig, type RenderCache, type RenderStats } from './build.js'
import { resolveConfig, type CarvePressConfig } from './config.js'
import type { Page } from './content/discover.js'
import { BuildError, SourceError } from './errors.js'
import type { RenderContext, RenderedPage } from './render/page.js'
import { startStaticServer, type RunningServer } from './server.js'

const require = createRequire(import.meta.url)
const defaultThemePath = require.resolve('../theme/default.css')
const packageJsonPath = require.resolve('../package.json')

export interface DevRebuildResult {
  ok: boolean
  config?: CarvePressConfig
  outDir?: string
  renderStats?: RenderStats
  error?: unknown
}

export interface DevRebuilder {
  rebuild(): Promise<DevRebuildResult>
}

export function formatCliError(error: unknown): string {
  if (error instanceof SourceError || error instanceof BuildError) return error.format()
  return error instanceof Error ? error.message : String(error)
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function fileHash(path: string): string {
  return sha256(readFileSync(path, 'utf8'))
}

function fileHashOrMissing(path: string): string {
  try {
    return fileHash(path)
  } catch {
    return 'missing'
  }
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => typeof item !== 'function' && item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`
}

function namedCount(values: { name?: string }[]): { count: number; names: string[] } {
  return {
    count: values.length,
    names: values.map((value, index) => value.name ?? `extension-${index}`).sort(),
  }
}

function serializableConfig(config: CarvePressConfig): unknown {
  return {
    ...config,
    carve: {
      ...config.carve,
      profile: config.carve.profile === undefined ? undefined : config.carve.profile.constructor.name,
      extensions: namedCount(config.carve.extensions),
    },
    extensions: namedCount(config.extensions),
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

function globalFingerprint(root: string, config: CarvePressConfig): string {
  const themePaths = [
    config.theme.css === undefined ? defaultThemePath : resolve(root, config.theme.css),
    ...(config.theme.extraCss ?? []).map((path) => resolve(root, path)),
  ]
  return stableJson({
    config: serializableConfig(config),
    theme: themePaths.map((path) => ({ path, hash: fileHashOrMissing(path) })),
    versions: {
      engine: packageVersion('@markup-carve/carve'),
      carvePress: packageVersion('@markup-carve/carve-press'),
    },
  })
}

function pageSourceHash(page: Page): string {
  const rawSource = (page as Page & { rawSource?: string }).rawSource
  return sha256(rawSource ?? stableJson({ frontmatter: page.frontmatter, source: page.source }))
}

interface CacheEntry {
  global: string
  sourceHash: string
  includeHashes: Record<string, string>
  rendered: RenderedPage
}

class DevRenderCache implements RenderCache {
  readonly stats: RenderStats = { rendered: 0, reused: 0 }
  private readonly entries = new Map<string, CacheEntry>()

  constructor(private global: string) {}

  setGlobal(global: string): void {
    if (global !== this.global) {
      this.entries.clear()
      this.global = global
    }
    this.stats.rendered = 0
    this.stats.reused = 0
  }

  render(page: Page, ctx: RenderContext, render: () => RenderedPage): RenderedPage {
    const key = page.srcPath
    const sourceHash = pageSourceHash(page)
    const entry = this.entries.get(key)
    if (
      entry !== undefined &&
      entry.global === this.global &&
      entry.sourceHash === sourceHash &&
      Object.entries(entry.includeHashes).every(([path, hash]) => fileHashOrMissing(path) === hash)
    ) {
      this.stats.reused += 1
      return { ...entry.rendered, page }
    }

    const rendered = render()
    this.stats.rendered += 1
    this.entries.set(key, {
      global: this.global,
      sourceHash,
      includeHashes: Object.fromEntries(
        rendered.includeFiles.map((file) => [file.path, fileHashOrMissing(file.path)]),
      ),
      rendered,
    })
    return rendered
  }
}

export function createDevRebuilder(root: string, onSuccess?: () => void): DevRebuilder {
  const renderCache = new DevRenderCache('')
  return {
    async rebuild() {
      try {
        const userConfig = await loadConfig(root, { bustCache: true })
        const config = resolveConfig(userConfig, root)
        const useIncremental = config.dev.incremental
        if (useIncremental) renderCache.setGlobal(globalFingerprint(root, config))
        const started = Date.now()
        const result = await buildSite({
          root,
          config: userConfig,
          writeManifest: false,
          ...(useIncremental ? { renderCache } : {}),
        })
        const work =
          useIncremental
            ? ` (${result.renderStats.rendered} rendered, ${result.renderStats.reused} reused)`
            : ''
        console.log(
          `carve-press: rebuilt ${result.routes.length} page(s)${work} into ${result.outDir} in ${
            Date.now() - started
          }ms`,
        )
        onSuccess?.()
        return { ok: true, config, outDir: result.outDir, renderStats: result.renderStats }
      } catch (error) {
        console.error(`carve-press: ${formatCliError(error)}`)
        return { ok: false, error }
      }
    },
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.stat(path)
    return true
  } catch {
    return false
  }
}

async function findConfigPath(root: string): Promise<string | undefined> {
  for (const name of ['carve-press.config.ts', 'carve-press.config.js', 'carve-press.config.mjs']) {
    const path = resolve(root, name)
    if (await exists(path)) return path
  }
  return undefined
}

async function collectDirectories(root: string, out: string[] = []): Promise<string[]> {
  if (!(await exists(root))) return out
  out.push(root)
  const entries = await fs.readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.isDirectory()) await collectDirectories(resolve(root, entry.name), out)
  }
  return out
}

type WatchListener = (event: string, filename: string | null) => void

function watchPath(path: string, onChange: (() => void) | WatchListener): FSWatcher[] {
  try {
    return [watch(path, onChange as WatchListener)]
  } catch {
    return []
  }
}

function onlyFor(name: string, onChange: () => void): WatchListener {
  return (_event, changed) => {
    if (changed === null || changed === name) onChange()
  }
}

function watchRecursive(path: string, onChange: () => void): FSWatcher[] {
  try {
    return [watch(path, { recursive: true }, onChange)]
  } catch {
    return []
  }
}

async function watchTree(path: string, onChange: () => void): Promise<FSWatcher[]> {
  try {
    const info = await fs.stat(path)
    // Watching a file means watching its directory, so the callback has to
    // filter: the project root holds the config and also whatever the build
    // writes next to it, and reacting to a sibling makes the build feed itself.
    if (info.isFile()) return watchPath(dirname(path), onlyFor(basename(path), onChange))
    if (!info.isDirectory()) return []
  } catch {
    return []
  }

  const recursive = watchRecursive(path, onChange)
  if (recursive.length > 0) return recursive
  const watchers: FSWatcher[] = []
  for (const dir of await collectDirectories(path)) watchers.push(...watchPath(dir, onChange))
  return watchers
}

async function watchConfigPaths(root: string, config: CarvePressConfig, onChange: () => void): Promise<FSWatcher[]> {
  const configPath = await findConfigPath(root)
  const paths = [
    resolve(root, config.srcDir),
    resolve(root, config.publicDir),
    ...(configPath === undefined ? [] : [configPath]),
    ...(config.theme.css === undefined ? [] : [resolve(root, config.theme.css)]),
    ...(config.theme.extraCss ?? []).map((path) => resolve(root, path)),
  ].filter((path): path is string => path !== undefined)

  const watchers: FSWatcher[] = []
  for (const path of paths) watchers.push(...(await watchTree(path, onChange)))
  return watchers
}

export async function startDevServer(opts: {
  root: string
  port: number
  host: string
}): Promise<RunningServer & { rebuild: () => Promise<DevRebuildResult> }> {
  const clients = new Set<ServerResponse>()
  const notifyReload = (): void => {
    for (const client of clients) client.write('event: reload\ndata: ok\n\n')
  }
  const rebuilder = createDevRebuilder(opts.root, notifyReload)
  const first = await rebuilder.rebuild()
  if (!first.ok || first.config === undefined || first.outDir === undefined) {
    throw first.error
  }

  let config = first.config
  let outDir = first.outDir
  let watchers: FSWatcher[] = []
  let timer: NodeJS.Timeout | undefined
  let rebuilding = false

  const rebuildAndRefresh = async (): Promise<DevRebuildResult> => {
    if (rebuilding) return { ok: false }
    rebuilding = true
    const result = await rebuilder.rebuild()
    rebuilding = false
    if (result.ok && result.config !== undefined && result.outDir !== undefined) {
      config = result.config
      outDir = result.outDir
      for (const watcher of watchers) watcher.close()
      watchers = await watchConfigPaths(opts.root, config, () => {
        if (timer !== undefined) clearTimeout(timer)
        timer = setTimeout(() => void rebuildAndRefresh(), 50)
      })
    }
    return result
  }

  watchers = await watchConfigPaths(opts.root, config, () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => void rebuildAndRefresh(), 50)
  })

  const running = await startStaticServer({
    outDir,
    config,
    getOutDir: () => outDir,
    getConfig: () => config,
    port: opts.port,
    host: opts.host,
    injectHtml: true,
    onEventsRequest(res) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })
      res.write('\n')
      clients.add(res)
      res.on('close', () => clients.delete(res))
      return true
    },
  })

  return {
    ...running,
    // The site lives under its base, so that is the URL a reader needs.
    url: `${running.url}${config.base}`,
    async close() {
      for (const watcher of watchers) watcher.close()
      if (timer !== undefined) clearTimeout(timer)
      await running.close()
    },
    rebuild: rebuildAndRefresh,
  }
}
