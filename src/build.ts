import { mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveConfig, type UserConfig } from './config.js'
import { discoverPages } from './content/discover.js'
import { outPathForRoute } from './content/route.js'
import { buildExtensionStack } from './render/extensions.js'
import type { ShikiOptions } from './render/shiki.js'
import { renderPage, type RenderedPage } from './render/page.js'
import { resolveSidebar, resolvePrevNext } from './nav.js'
import { LAYOUTS, docLayout } from './layout/doc.js'
import { validateLinks, validateNav, validateCrossrefs } from './validate.js'
import { BuildEventBus } from './events.js'
import { BuildError } from './errors.js'

export interface BuildResult {
  rendered: RenderedPage[]
  outDir: string
  routes: string[]
}

const DEFAULT_SHIKI: ShikiOptions = {
  langs: ['html', 'bash', 'php', 'ts', 'js', 'go', 'python', 'rust', 'json', 'yaml'],
  themes: { light: 'github-light', dark: 'github-dark' },
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
  const discovered = await discoverPages(srcDir, config.srcExclude)
  const { pages } = await bus.emit('contentDiscovered', { pages: discovered })

  const extensions = await buildExtensionStack(config, opts.shiki ?? DEFAULT_SHIKI)
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

  validateNav(config.themeConfig, routes)
  validateCrossrefs(pages)
  validateLinks(rendered, routes, config.ignoreDeadLinks)

  for (const result of rendered) {
    const sidebar = resolveSidebar(result.page.route, config.themeConfig.sidebar)
    const { prev, next } = resolvePrevNext(result.page.route, sidebar)
    const layoutName =
      typeof result.page.frontmatter.layout === 'string' ? result.page.frontmatter.layout : 'doc'
    const layout = LAYOUTS[layoutName] ?? docLayout
    const html = layout({ config, rendered: result, sidebar, prev, next })

    const outPath = resolve(outDir, outPathForRoute(result.page.route, config.cleanUrls))
    await mkdir(dirname(outPath), { recursive: true })
    await writeFile(outPath, html, 'utf8')
    await bus.emit('pageWritten', { rendered: result, outPath })
  }

  await bus.emit('buildCompleted', { rendered, outDir })
  return { rendered, outDir, routes: [...routes] }
}
