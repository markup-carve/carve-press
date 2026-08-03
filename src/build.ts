import { execFile } from 'node:child_process'
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import {
  resolveConfig,
  type CarvePressConfig,
  type HeadTag,
  type LocaleConfig,
  type PlaygroundConfig,
  type SidebarConfigGroup,
  type SidebarGroup,
  type SidebarItem,
  type ThemeConfig,
  type ThemeLabels,
  type UserConfig,
} from './config.js'
import { discoverPages, type Page } from './content/discover.js'
import { outPathForRoute, routeKey } from './content/route.js'
import { buildExtensionStack } from './render/extensions.js'
import type { ShikiOptions } from './render/shiki.js'
import { renderPage, type RenderedPage } from './render/page.js'
import { resolveByPrefix, resolveSidebar, resolvePrevNext, type FlatLink } from './nav.js'
import { LAYOUTS } from './layout/doc.js'
import {
  validateLinks,
  validateNav,
  validateCrossrefs,
  validatePageNavOverrides,
} from './validate.js'
import { BuildEventBus } from './events.js'
import type { RedirectEntry } from './events.js'
import { BuildError, SourceError } from './errors.js'

const require = createRequire(import.meta.url)
const execFileAsync = promisify(execFile)
const defaultThemePath = require.resolve('../theme/default.css')
const defaultSearchScriptPath = require.resolve('../theme/search.js')
const miniSearchScriptPath = resolveMiniSearchScriptPath()
const defaultPlaygroundScriptPath = require.resolve('../theme/playground.js')
const defaultTableScrollScriptPath = require.resolve('../theme/table-scroll.js')
const defaultCodeCopyScriptPath = require.resolve('../theme/code-copy.js')
const defaultOutlineScriptPath = require.resolve('../theme/outline.js')
const defaultNavScriptPath = require.resolve('../theme/nav.js')
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

async function writeThemeCss(opts: {
  root: string
  outDir: string
  css?: string
  extraCss?: string[]
}): Promise<void> {
  const source = opts.css === undefined ? defaultThemePath : resolve(opts.root, opts.css)
  const parts = [await readFile(source, 'utf8')]
  for (const extra of opts.extraCss ?? []) {
    parts.push(await readFile(resolve(opts.root, extra), 'utf8'))
  }
  const css = parts.join('\n')
  const outPath = resolve(opts.outDir, 'assets/style.css')
  await mkdir(dirname(outPath), { recursive: true })
  await writeFile(outPath, css, 'utf8')
}

async function writeSearchScript(outDir: string): Promise<void> {
  const outPath = resolve(outDir, 'assets/search.js')
  await mkdir(dirname(outPath), { recursive: true })
  await copyFile(defaultSearchScriptPath, outPath)
  await copyFile(miniSearchScriptPath, resolve(outDir, 'assets/minisearch.js'))
}

function resolveMiniSearchScriptPath(): string {
  try {
    return require.resolve('minisearch/dist/es/index.js')
  } catch {
    const entry = require.resolve('minisearch')
    if (entry.endsWith('dist/cjs/index.cjs')) return resolve(dirname(entry), '../es/index.js')
    return resolve(dirname(entry), 'dist/es/index.js')
  }
}

function profileBaseHost(hostname: string | undefined): string | undefined {
  if (hostname === undefined || hostname === '') return undefined
  // Hostname, not host: the engine compares absolute link hosts with the port
  // already stripped, so keeping `:3000` here rejects same-site links.
  try {
    return new URL(hostname).hostname
  } catch {
    return hostname
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '')
      .replace(/:\d+$/, '')
  }
}

function partitionNotFoundPage(pages: Page[]): { pages: Page[]; notFoundPage?: Page } {
  const notFound = pages.find((page) => page.relPath === '404.crv' || page.relPath === '404.carve')
  if (notFound === undefined) return { pages }
  return { pages: pages.filter((page) => page !== notFound), notFoundPage: notFound }
}

function validateUniqueRoutes(pages: Page[]): void {
  const seen = new Map<string, string>()
  for (const page of pages) {
    const key = routeKey(page.route)
    const previous = seen.get(key)
    if (previous !== undefined) {
      throw new BuildError(`duplicate route ${key}`, [
        `${previous} and ${page.relPath} both resolve to ${key}`,
      ])
    }
    seen.set(key, page.relPath)
  }
}

function builtInNotFoundPage(srcDir: string, title: string): Page {
  return {
    route: '/404',
    srcPath: resolve(srcDir, '404.crv'),
    relPath: '404.crv',
    frontmatter: { title },
    source: 'The page you requested could not be found. [Return home](/).\n',
    bodyStartLine: 1,
  }
}

interface ActiveLocale {
  prefix: string
  lang: string
  label: string
  title: string
  description?: string
  themeConfig: ThemeConfig
  labels: ThemeLabels
}

interface PageMeta {
  head: HeadTag[]
  image?: string
  outlineLevels?: [number, number] | false
  aside: boolean
  sidebar: boolean
  prev?: FlatLink | false
  next?: FlatLink | false
  editLink: boolean
  lastUpdated: boolean
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function isGeneratedSidebarGroup(group: SidebarConfigGroup): group is SidebarConfigGroup & { generate: string } {
  return typeof (group as { generate?: unknown }).generate === 'string'
}

function sourceError(page: Page, key: string): SourceError {
  return new SourceError(page.relPath, 1, 1, `frontmatter: invalid ${key}`)
}

function validUrl(value: string): boolean {
  return value.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//')
}

function pageHead(page: Page): HeadTag[] {
  const value = page.frontmatter.head
  if (value === undefined) return []
  if (!Array.isArray(value)) throw sourceError(page, 'head')
  const out: HeadTag[] = []
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string') {
      throw sourceError(page, 'head')
    }
    const attrs = objectValue(entry[1])
    if (attrs === undefined || Object.values(attrs).some((attr) => typeof attr !== 'string')) {
      throw sourceError(page, 'head')
    }
    out.push([entry[0], attrs as Record<string, string>])
  }
  return out
}

function imageMeta(page: Page): string | undefined {
  const key = page.frontmatter.image === undefined ? 'ogImage' : 'image'
  const image = page.frontmatter[key]
  if (image === undefined) return undefined
  if (typeof image !== 'string' || image === '' || !validUrl(image)) throw sourceError(page, key)
  return image
}

function outlineLevels(page: Page): [number, number] | false | undefined {
  const value = page.frontmatter.outline
  if (value === undefined) return undefined
  if (value === false) return false
  if (value === 'deep') return [2, 6]
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 6) return [value, value]
  if (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number' &&
    Number.isInteger(value[0]) &&
    Number.isInteger(value[1]) &&
    value[0] >= 1 &&
    value[1] <= 6 &&
    value[0] <= value[1]
  ) {
    return [value[0], value[1]]
  }
  throw sourceError(page, 'outline')
}

function navOverride(page: Page, key: 'prev' | 'next'): FlatLink | false | undefined {
  const value = page.frontmatter[key]
  if (value === undefined) return undefined
  if (value === false) return false
  const record = objectValue(value)
  if (record === undefined || typeof record.text !== 'string' || typeof record.link !== 'string') {
    throw sourceError(page, key)
  }
  return { text: record.text, link: record.link }
}

function booleanFlag(page: Page, key: 'aside' | 'sidebar' | 'editLink' | 'lastUpdated'): boolean | undefined {
  const value = page.frontmatter[key]
  if (value === undefined) return undefined
  if (value === false) return false
  throw sourceError(page, key)
}

function pageMeta(page: Page): PageMeta {
  const order = page.frontmatter.order
  if (order !== undefined && typeof order !== 'number') throw sourceError(page, 'order')
  return {
    head: pageHead(page),
    image: imageMeta(page),
    outlineLevels: outlineLevels(page),
    aside: booleanFlag(page, 'aside') !== false,
    sidebar: booleanFlag(page, 'sidebar') !== false,
    prev: navOverride(page, 'prev'),
    next: navOverride(page, 'next'),
    editLink: booleanFlag(page, 'editLink') !== false,
    lastUpdated: booleanFlag(page, 'lastUpdated') !== false,
  }
}

function activeLocale(config: CarvePressConfig, route: string): ActiveLocale {
  const fallback: LocaleConfig = {
    lang: 'en',
    label: 'English',
  }
  const locales = Object.keys(config.locales).length === 0 ? { '/': fallback } : config.locales
  const locale = resolveByPrefix(route, locales) ?? fallback
  const prefix = Object.entries(locales).find(([, value]) => value === locale)?.[0] ?? '/'
  const labels = { ...config.themeConfig.labels, ...(locale.themeConfig?.labels ?? {}) }
  const themeConfig: ThemeConfig = {
    ...config.themeConfig,
    nav: locale.themeConfig?.nav ?? config.themeConfig.nav,
    sidebar: locale.themeConfig?.sidebar ?? config.themeConfig.sidebar,
    footer: locale.themeConfig?.footer ?? config.themeConfig.footer,
    editLink: locale.themeConfig?.editLink ?? config.themeConfig.editLink,
    outline: {
      level:
        locale.themeConfig?.outline?.level === undefined
          ? config.themeConfig.outline.level
          : locale.themeConfig.outline.level === 'deep'
            ? [2, 6]
            : locale.themeConfig.outline.level === false
              ? [7, 6]
              : typeof locale.themeConfig.outline.level === 'number'
                ? [locale.themeConfig.outline.level, locale.themeConfig.outline.level]
                : locale.themeConfig.outline.level,
    },
    labels,
  }
  return {
    prefix,
    lang: locale.lang,
    label: locale.label,
    title: locale.title ?? config.title,
    description: locale.description ?? config.description,
    themeConfig,
    labels,
  }
}

function shouldCollectLastUpdated(config: CarvePressConfig): boolean {
  return config.themeConfig.lastUpdated === true
}

function renderOutlineLevels(levels: [number, number] | false): [number, number] | false {
  return levels === false || levels[0] > levels[1] ? false : levels
}

function sortPagesForSidebar(a: RenderedPage, b: RenderedPage): number {
  const aIndex = a.page.relPath.split('/').at(-1)?.startsWith('index.') === true
  const bIndex = b.page.relPath.split('/').at(-1)?.startsWith('index.') === true
  if (aIndex !== bIndex) return aIndex ? -1 : 1
  const aOrder = a.page.frontmatter.order
  const bOrder = b.page.frontmatter.order
  if (typeof aOrder === 'number' && typeof bOrder === 'number' && aOrder !== bOrder) return aOrder - bOrder
  if (typeof aOrder === 'number' && typeof bOrder !== 'number') return -1
  if (typeof aOrder !== 'number' && typeof bOrder === 'number') return 1
  return a.searchDoc.title.localeCompare(b.searchDoc.title)
}

function generatedSidebarItems(prefix: string, rendered: RenderedPage[]): SidebarItem[] {
  const children = new Map<string, RenderedPage[]>()
  const direct: RenderedPage[] = []
  for (const page of rendered) {
    if (!page.page.route.startsWith(prefix)) continue
    if (page.page.frontmatter.sidebar === false || page.page.frontmatter.draft === true) continue
    const rest = page.page.route.slice(prefix.length)
    if (rest === '' || !rest.includes('/')) {
      direct.push(page)
      continue
    }
    const dir = rest.slice(0, rest.indexOf('/') + 1)
    children.set(dir, [...(children.get(dir) ?? []), page])
  }

  const items: SidebarItem[] = direct.sort(sortPagesForSidebar).map((page) => ({
    text: page.searchDoc.title,
    link: page.page.route,
  }))
  for (const [dir, pages] of [...children.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const dirPrefix = `${prefix}${dir}`
    const index = pages.find((page) => page.page.route === dirPrefix)
    items.push({
      text: index?.searchDoc.title ?? dir.replace(/\/$/, ''),
      ...(index === undefined ? {} : { link: index.page.route }),
      items: generatedSidebarItems(
        dirPrefix,
        index === undefined ? pages : pages.filter((page) => page !== index),
      ),
    })
  }
  return items
}

function expandSidebar(
  sidebar: Record<string, SidebarConfigGroup[]>,
  rendered: RenderedPage[],
): Record<string, SidebarGroup[]> {
  return Object.fromEntries(
    Object.entries(sidebar).map(([key, groups]) => [
      key,
      groups.map((group) =>
        isGeneratedSidebarGroup(group)
          ? {
              text: group.text,
              collapsed: group.collapsed,
              items: generatedSidebarItems(group.generate, rendered),
            }
          : group,
      ),
    ]),
  )
}

async function writeTableScrollScript(outDir: string): Promise<void> {
  const outPath = resolve(outDir, 'assets/table-scroll.js')
  await mkdir(dirname(outPath), { recursive: true })
  await copyFile(defaultTableScrollScriptPath, outPath)
}

async function writeCodeCopyScript(outDir: string): Promise<void> {
  const outPath = resolve(outDir, 'assets/code-copy.js')
  await mkdir(dirname(outPath), { recursive: true })
  await copyFile(defaultCodeCopyScriptPath, outPath)
}

async function writeOutlineScript(outDir: string): Promise<void> {
  const outPath = resolve(outDir, 'assets/outline.js')
  await mkdir(dirname(outPath), { recursive: true })
  await copyFile(defaultOutlineScriptPath, outPath)
}

async function writeNavScript(outDir: string): Promise<void> {
  const outPath = resolve(outDir, 'assets/nav.js')
  await mkdir(dirname(outPath), { recursive: true })
  await copyFile(defaultNavScriptPath, outPath)
}

async function copyConfiguredPlaygroundAssets(outDir: string, playground: PlaygroundConfig): Promise<void> {
  const playgroundDir = resolve(outDir, 'assets/playground')
  if (playground.wasmEngine !== undefined) {
    await copyDirectoryContents(playground.wasmEngine, resolve(playgroundDir, basename(playground.wasmEngine)))
  }
  if (playground.mermaid !== undefined) {
    await mkdir(playgroundDir, { recursive: true })
    await copyFile(playground.mermaid, resolve(playgroundDir, basename(playground.mermaid)))
  }
  if (playground.chart !== undefined) {
    await mkdir(playgroundDir, { recursive: true })
    await copyFile(playground.chart, resolve(playgroundDir, basename(playground.chart)))
  }
}

async function writePlaygroundAssets(outDir: string, playground: PlaygroundConfig): Promise<void> {
  const scriptPath = resolve(outDir, 'assets/playground.js')
  await mkdir(dirname(scriptPath), { recursive: true })
  await copyFile(defaultPlaygroundScriptPath, scriptPath)
  await copyDirectoryContents(carveEngineDistPath, resolve(outDir, 'assets/carve'))
  await copyConfiguredPlaygroundAssets(outDir, playground)
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

async function fileExists(path: string): Promise<boolean> {
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
    throw new BuildError(`cannot inspect route manifest ${path}`, [reason])
  }
}

function manifestText(routes: Iterable<string>): string {
  return `${JSON.stringify([...routes].sort(), null, 2)}\n`
}

async function readRouteManifest(path: string): Promise<string[]> {
  let raw
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new BuildError(`cannot read route manifest ${path}`, [reason])
  }
  let parsed
  try {
    parsed = JSON.parse(raw) as unknown
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new BuildError(`cannot parse route manifest ${path}`, [reason])
  }
  if (!Array.isArray(parsed) || parsed.some((route) => typeof route !== 'string')) {
    throw new BuildError(`route manifest ${path} must be a JSON array of route strings`)
  }
  return parsed as string[]
}

async function validateRouteManifest(opts: {
  root: string
  manifest: string | false
  routes: Set<string>
  redirects: RedirectEntry[]
}): Promise<void> {
  if (opts.manifest === false) return
  const manifestPath = resolve(opts.root, opts.manifest)
  if (!(await fileExists(manifestPath))) return
  const previous = await readRouteManifest(manifestPath)
  const redirectSources = new Set(opts.redirects.map((entry) => entry.source))
  const missing = previous.filter((route) => !opts.routes.has(route) && !redirectSources.has(route))
  if (missing.length === 0) return
  throw new BuildError(
    `${missing.length} published route(s) disappeared without a redirect (${opts.manifest})`,
    [
      ...missing,
      '',
      'Restore the page, add redirectFrom to the page that replaced it, or add a redirects entry.',
    ],
  )
}

async function writeRouteManifest(root: string, manifest: string | false, routes: Set<string>): Promise<void> {
  if (manifest === false) return
  const manifestPath = resolve(root, manifest)
  await mkdir(dirname(manifestPath), { recursive: true })
  await writeFile(manifestPath, manifestText(routes), 'utf8')
}

/** Load `carve-press.config.{ts,js,mjs}` from a project root. */
export async function loadConfig(root: string, opts: { bustCache?: boolean } = {}): Promise<UserConfig> {
  for (const name of ['carve-press.config.ts', 'carve-press.config.js', 'carve-press.config.mjs']) {
    const path = resolve(root, name)
    if (!(await configExists(path))) continue

    const href = `${pathToFileURL(path).href}${opts.bustCache === true ? `?t=${Date.now()}` : ''}`
    const mod = (await import(href)) as { default?: UserConfig }
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
  const config = resolveConfig(opts.config, opts.root)
  const bus = new BuildEventBus()
  for (const extension of config.extensions) extension.setup(bus)

  await bus.emit('buildStarted', { config })

  const srcDir = resolve(opts.root, config.srcDir)
  const outDir = resolve(opts.root, config.outDir)
  const publicDir = resolve(opts.root, config.publicDir)
  if (await directoryExists(publicDir)) {
    await copyDirectoryContents(publicDir, outDir)
  }
  await writeThemeCss({
    root: opts.root,
    outDir,
    css: config.theme.css,
    extraCss: config.theme.extraCss,
  })
  if (config.search !== false) await writeSearchScript(outDir)
  await writeTableScrollScript(outDir)
  await writeCodeCopyScript(outDir)
  await writeOutlineScript(outDir)
  await writeNavScript(outDir)

  const discovered = await discoverPages(srcDir, config.srcExclude)
  const discoveredContent = await bus.emit('contentDiscovered', { pages: discovered })
  validateUniqueRoutes(discoveredContent.pages)
  const redirectPayload = await bus.emit('redirectsCollected', { pages: discoveredContent.pages, redirects: [] })
  const { pages, notFoundPage } = partitionNotFoundPage(discoveredContent.pages)
  const lastUpdated =
    shouldCollectLastUpdated(config)
      ? await collectLastUpdatedTimes(opts.root, srcDir, pages)
      : new Map<string, Date>()

  const extensions = await buildExtensionStack(config, opts.shiki ?? config.shiki, opts.root)
  const stack = (await bus.emit('rendererCreated', { extensions })).extensions
  const host = profileBaseHost(config.hostname)

  const routes = new Set(pages.map((p) => p.route))
  await validateRouteManifest({
    root: opts.root,
    manifest: config.routeManifest,
    routes,
    redirects: redirectPayload.redirects,
  })
  const rendered: RenderedPage[] = []
  const metas = new Map<string, PageMeta>()
  for (const page of pages) {
    const locale = activeLocale(config, page.route)
    const meta = pageMeta(page)
    metas.set(page.srcPath, meta)
    const outline = meta.outlineLevels ?? locale.themeConfig.outline.level
    const result = renderPage(page, {
      extensions: stack,
      outlineLevels: renderOutlineLevels(outline),
      includeRoots: [srcDir, opts.root],
      base: config.base,
      profile: config.carve.profile,
      profileBaseHost: host,
    })
    const after = await bus.emit('pageRendered', { rendered: result, html: result.html })
    rendered.push({ ...result, html: after.html })
  }

  const notFoundLocale = activeLocale(config, '/404')
  const notFoundSource = notFoundPage ?? builtInNotFoundPage(srcDir, notFoundLocale.labels.pageNotFound)
  const notFoundMeta = pageMeta(notFoundSource)
  const notFoundOutline = notFoundMeta.outlineLevels ?? notFoundLocale.themeConfig.outline.level
  const notFoundRendered = renderPage(notFoundSource, {
    extensions: stack,
    outlineLevels: renderOutlineLevels(notFoundOutline),
    includeRoots: [srcDir, opts.root],
    base: config.base,
    profile: config.carve.profile,
    profileBaseHost: host,
  })

  // The 404 page is written outside the normal loop but gets the same layout,
  // so a playground that only appears there still needs the runtime shipped.
  if ([...rendered, notFoundRendered].some((result) => result.html.includes('<carve-playground'))) {
    await writePlaygroundAssets(outDir, config.playground)
  }

  const expandedConfig: CarvePressConfig = {
    ...config,
    themeConfig: {
      ...config.themeConfig,
      sidebar: expandSidebar(config.themeConfig.sidebar, rendered),
    },
    locales: Object.fromEntries(
      Object.entries(config.locales).map(([key, locale]) => [
        key,
        {
          ...locale,
          themeConfig:
            locale.themeConfig?.sidebar === undefined
              ? locale.themeConfig
              : {
                  ...locale.themeConfig,
                  sidebar: expandSidebar(locale.themeConfig.sidebar, rendered),
                },
        },
      ]),
    ),
  }

  validateNav(expandedConfig.themeConfig, routes)
  for (const prefix of Object.keys(expandedConfig.locales)) {
    validateNav(activeLocale(expandedConfig, prefix).themeConfig, routes)
  }
  validateCrossrefs(pages)
  validateLinks(rendered, routes, config.ignoreDeadLinks, config.base)
  validateLinks([notFoundRendered], routes, config.ignoreDeadLinks, config.base)
  validatePageNavOverrides(
    rendered.map((result) => {
      const meta = metas.get(result.page.srcPath) ?? pageMeta(result.page)
      return {
        relPath: result.page.relPath,
        links: [
          meta.prev === false ? undefined : meta.prev?.link,
          meta.next === false ? undefined : meta.next?.link,
        ],
      }
    }),
    routes,
    config.ignoreDeadLinks,
  )

  const layouts = { ...LAYOUTS, ...config.layouts }
  const knownLayoutNames = Object.keys(layouts).sort().join(', ')
  const selectLayout = (result: RenderedPage) => {
    const layoutName =
      typeof result.page.frontmatter.layout === 'string' ? result.page.frontmatter.layout : 'doc'
    const layout = layouts[layoutName]
    if (layout === undefined) {
      throw new SourceError(
        result.page.relPath,
        1,
        1,
        `unknown layout "${layoutName}" (known layouts: ${knownLayoutNames})`,
      )
    }
    return layout
  }

  for (const result of rendered) {
    const locale = activeLocale(expandedConfig, result.page.route)
    const meta = metas.get(result.page.srcPath) ?? pageMeta(result.page)
    const sidebar = meta.sidebar ? resolveSidebar(result.page.route, locale.themeConfig.sidebar as Record<string, SidebarGroup[]>) : []
    const computed = resolvePrevNext(result.page.route, sidebar)
    const prev = meta.prev === false ? undefined : meta.prev ?? computed.prev
    const next = meta.next === false ? undefined : meta.next ?? computed.next
    const layout = selectLayout(result)
    const html = layout({
      config: expandedConfig,
      rendered: result,
      sidebar,
      prev,
      next,
      lastUpdated: meta.lastUpdated ? lastUpdated.get(result.page.srcPath) : undefined,
      locale,
      themeConfig: locale.themeConfig,
      labels: locale.labels,
      meta,
      routes,
    })

    const outPath = resolve(outDir, outPathForRoute(result.page.route, config.cleanUrls))
    await mkdir(dirname(outPath), { recursive: true })
    await writeFile(outPath, html, 'utf8')
    await bus.emit('pageWritten', { rendered: result, outPath })
  }

  // Resolved against the expanded config: a generated sidebar group still
  // carries its `generate` marker before expansion, and the layout would crash
  // on a group with no items while writing 404.html.
  const expandedNotFoundLocale = activeLocale(expandedConfig, '/404')
  const notFoundHtml = selectLayout(notFoundRendered)({
    config: expandedConfig,
    rendered: notFoundRendered,
    sidebar: resolveSidebar(
      notFoundRendered.page.route,
      expandedNotFoundLocale.themeConfig.sidebar as Record<string, SidebarGroup[]>,
    ),
    locale: expandedNotFoundLocale,
    themeConfig: expandedNotFoundLocale.themeConfig,
    labels: expandedNotFoundLocale.labels,
    meta: notFoundMeta,
    routes,
  })
  const notFoundOutPath = resolve(outDir, '404.html')
  await mkdir(dirname(notFoundOutPath), { recursive: true })
  await writeFile(notFoundOutPath, notFoundHtml, 'utf8')

  await bus.emit('buildCompleted', { rendered, outDir })
  await writeRouteManifest(opts.root, config.routeManifest, routes)
  return { rendered, outDir, routes: [...routes] }
}
