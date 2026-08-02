import { execFile } from 'node:child_process'
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { resolveConfig, type UserConfig } from './config.js'
import { discoverPages, type Page } from './content/discover.js'
import { outPathForRoute } from './content/route.js'
import { buildExtensionStack } from './render/extensions.js'
import type { ShikiOptions } from './render/shiki.js'
import { renderPage, type RenderedPage } from './render/page.js'
import { resolveSidebar, resolvePrevNext } from './nav.js'
import { LAYOUTS, docLayout } from './layout/doc.js'
import { validateLinks, validateNav, validateCrossrefs } from './validate.js'
import { BuildEventBus } from './events.js'
import { BuildError } from './errors.js'

const require = createRequire(import.meta.url)
const execFileAsync = promisify(execFile)
const defaultThemePath = require.resolve('../theme/default.css')
const defaultSearchScriptPath = require.resolve('../theme/search.js')
const defaultPlaygroundScriptPath = require.resolve('../theme/playground.js')
const defaultTableScrollScriptPath = require.resolve('../theme/table-scroll.js')
const defaultOutlineScriptPath = require.resolve('../theme/outline.js')
const carveGrammarPath = require.resolve('@markup-carve/carve-grammars/textmate/carve.tmLanguage.json')
const carveEngineDistPath = resolve(dirname(carveGrammarPath), '../../carve/dist')

export interface BuildResult {
  rendered: RenderedPage[]
  outDir: string
  routes: string[]
}

async function configExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch (error) {
    if (
      error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      (error.code === 'ENOENT' || error.code === 'ENOTDIR')
    ) {
      return false
    }
    const reason = error instanceof Error ? error.message : String(error)
    throw new BuildError(`cannot inspect config file ${path}`, [reason])
  }
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch (error) {
    if (
      error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      (error.code === 'ENOENT' || error.code === 'ENOTDIR')
    ) {
      return false
    }
    const reason = error instanceof Error ? error.message : String(error)
    throw new BuildError(`cannot inspect directory ${path}`, [reason])
  }
}

async function copyDirectoryContents(src: string, dest: string): Promise<void> {
  const entries = await readdir(src, { withFileTypes: true })
  await mkdir(dest, { recursive: true })
  for (const entry of entries) {
    const srcPath = resolve(src, entry.name)
    const destPath = resolve(dest, entry.name)
    if (entry.isDirectory()) {
      await copyDirectoryContents(srcPath, destPath)
    } else if (entry.isFile()) {
      await mkdir(dirname(destPath), { recursive: true })
      await copyFile(srcPath, destPath)
    }
  }
}

async function writeThemeCss(opts: { root: string; outDir: string; css?: string }): Promise<void> {
  const source = opts.css === undefined ? defaultThemePath : resolve(opts.root, opts.css)
  const css = await readFile(source, 'utf8')
  const outPath = resolve(opts.outDir, 'assets/style.css')
  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, css, 'utf8')
}

async function writeSearchScript(outDir: string): Promise<void> {
  const outPath = resolve(outDir, 'assets/search.js')
  await mkdir(dirname(outPath), { recursive: true })
  await copyFile(defaultSearchScriptPath, outPath)
}

async function writeTableScrollScript(outDir: string): Promise<void> {
  const outPath = resolve(outDir, 'assets/table-scroll.js')
  await mkdir(dirname(outPath), { recursive: true })
  await copyFile(defaultTableScrollScriptPath, outPath)
}

async function writeOutlineScript(outDir: string): Promise<void> {
  const outPath = resolve(outDir, 'assets/outline.js')
  await mkdir(dirname(outPath), { recursive: true })
  await copyFile(defaultOutlineScriptPath, outPath)
}

async function writePlaygroundAssets(outDir: string): Promise<void> {
  const scriptPath = resolve(outDir, 'assets/playground.js')
  await mkdir(dirname(scriptPath), { recursive: true })
  await copyFile(defaultPlaygroundScriptPath, scriptPath)
  await copyDirectoryContents(carveEngineDistPath, resolve(outDir, 'assets/carve'))
}

async function collectGitUpdatedTimes(root: string, srcDir: string): Promise<Map<string, Date>> {
  try {
    const top = await execFileAsync('git', ['-C', root, 'rev-parse', '--show-toplevel'])
    const topLevel = top.stdout.trim()
    if (topLevel === '') return new Map()
    const srcPathspec = relative(topLevel, srcDir).split(sep).join('/')
    const pathspec = srcPathspec === '' ? '.' : srcPathspec
    const log = await execFileAsync('git', ['-C', root, 'log', '--format=%ct', '--name-only', '--', pathspec], {
      maxBuffer: 1024 * 1024 * 20,
    })
    const times = new Map<string, Date>()
    let current: Date | undefined
    for (const line of log.stdout.split(/\r?\n/)) {
      if (line === '') continue
      if (/^\d+$/.test(line)) {
        current = new Date(Number(line) * 1000)
        continue
      }
      if (current === undefined) continue
      const absPath = resolve(topLevel, line)
      if (!times.has(absPath)) times.set(absPath, current)
    }
    return times
  } catch {
    return new Map()
  }
}

async function collectLastUpdatedTimes(root: string, srcDir: string, pages: Page[]): Promise<Map<string, Date>> {
  const gitTimes = await collectGitUpdatedTimes(root, srcDir)
  const times = new Map<string, Date>()
  for (const page of pages) {
    const gitTime = gitTimes.get(page.srcPath)
    if (gitTime !== undefined) {
      times.set(page.srcPath, gitTime)
      continue
    }
    try {
      times.set(page.srcPath, (await stat(page.srcPath)).mtime)
    } catch {
      // Last-updated metadata must not decide whether a content page builds.
    }
  }
  return times
}

/** Load `carve-press.config.{ts,js,mjs}` from a project root. */
export async function loadConfig(root: string): Promise<UserConfig> {
  for (const name of ['carve-press.config.ts', 'carve-press.config.js', 'carve-press.config.mjs']) {
    const path = resolve(root, name)
    if (!(await configExists(path))) continue

    const mod = (await import(pathToFileURL(path).href)) as { default?: UserConfig }
    if (mod.default === undefined) {
      throw new BuildError(`${name} has no default export`)
    }
    return mod.default
  }
  throw new BuildError(`no carve-press.config.{ts,js,mjs} found in ${root}`)
}

export async function buildSite(opts: {
  root: string
  config: UserConfig
  shiki?: ShikiOptions
}): Promise<BuildResult> {
  const config = resolveConfig(opts.config)
  const bus = new BuildEventBus()
  for (const extension of config.extensions) extension.setup(bus)

  await bus.emit('buildStarted', { config })

  const srcDir = resolve(opts.root, config.srcDir)
  const outDir = resolve(opts.root, config.outDir)
  const publicDir = resolve(opts.root, config.publicDir)
  if (await directoryExists(publicDir)) {
    await copyDirectoryContents(publicDir, outDir)
  }
  await writeThemeCss({ root: opts.root, outDir, css: config.theme.css })
  if (config.search !== false) await writeSearchScript(outDir)
  await writeTableScrollScript(outDir)
  await writeOutlineScript(outDir)

  const discovered = await discoverPages(srcDir, config.srcExclude)
  const { pages } = await bus.emit('contentDiscovered', { pages: discovered })
  const lastUpdated =
    config.themeConfig.lastUpdated === true
      ? await collectLastUpdatedTimes(opts.root, srcDir, pages)
      : new Map<string, Date>()

  const extensions = await buildExtensionStack(config, opts.shiki ?? config.shiki)
  const stack = (await bus.emit('rendererCreated', { extensions })).extensions

  const routes = new Set(pages.map((p) => p.route))
  const rendered: RenderedPage[] = []
  for (const page of pages) {
    const result = renderPage(page, {
      extensions: stack,
      outlineLevels: config.themeConfig.outline.level,
      includeRoots: [srcDir, opts.root],
    })
    const after = await bus.emit('pageRendered', { rendered: result, html: result.html })
    rendered.push({ ...result, html: after.html })
  }

  if (rendered.some((result) => result.html.includes('<carve-playground'))) {
    await writePlaygroundAssets(outDir)
  }

  validateNav(config.themeConfig, routes)
  validateCrossrefs(pages)
  validateLinks(rendered, routes, config.ignoreDeadLinks)

  for (const result of rendered) {
    const sidebar = resolveSidebar(result.page.route, config.themeConfig.sidebar)
    const { prev, next } = resolvePrevNext(result.page.route, sidebar)
    const layoutName =
      typeof result.page.frontmatter.layout === 'string' ? result.page.frontmatter.layout : 'doc'
    const layout = LAYOUTS[layoutName] ?? docLayout
    const html = layout({
      config,
      rendered: result,
      sidebar,
      prev,
      next,
      lastUpdated: lastUpdated.get(result.page.srcPath),
    })

    const outPath = resolve(outDir, outPathForRoute(result.page.route, config.cleanUrls))
    await mkdir(dirname(outPath), { recursive: true })
    await writeFile(outPath, html, 'utf8')
    await bus.emit('pageWritten', { rendered: result, outPath })
  }

  await bus.emit('buildCompleted', { rendered, outDir })
  return { rendered, outDir, routes: [...routes] }
}
