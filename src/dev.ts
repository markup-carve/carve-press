import { type FSWatcher, promises as fs, watch } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { ServerResponse } from 'node:http'
import { buildSite, loadConfig } from './build.js'
import { resolveConfig, type CarvePressConfig } from './config.js'
import { BuildError, SourceError } from './errors.js'
import { startStaticServer, type RunningServer } from './server.js'

export interface DevRebuildResult {
  ok: boolean
  config?: CarvePressConfig
  outDir?: string
  error?: unknown
}

export interface DevRebuilder {
  rebuild(): Promise<DevRebuildResult>
}

export function formatCliError(error: unknown): string {
  if (error instanceof SourceError || error instanceof BuildError) return error.format()
  return error instanceof Error ? error.message : String(error)
}

export function createDevRebuilder(root: string, onSuccess?: () => void): DevRebuilder {
  return {
    async rebuild() {
      try {
        const userConfig = await loadConfig(root, { bustCache: true })
        const started = Date.now()
        const result = await buildSite({ root, config: userConfig })
        const config = resolveConfig(userConfig, root)
        console.log(
          `carve-press: rebuilt ${result.routes.length} page(s) into ${result.outDir} in ${
            Date.now() - started
          }ms`,
        )
        onSuccess?.()
        return { ok: true, config, outDir: result.outDir }
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

function watchPath(path: string, onChange: () => void): FSWatcher[] {
  try {
    return [watch(path, onChange)]
  } catch {
    return []
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
    if (info.isFile()) return watchPath(dirname(path), onChange)
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
