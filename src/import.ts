import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, posix, relative, resolve, sep } from 'node:path'
import {
  migrateHtml,
  migrateMarkdown,
  parse,
  type MigrationDiagnostic,
} from '@markup-carve/carve'
import { stringify } from 'yaml'
import { BuildError } from './errors.js'

export type ImportFormat = 'markdown' | 'html'

export interface ImportOptions {
  root: string
  /** File or directory to import, relative to `root`. */
  source: string
  /** Directory the `.crv` pages are written to, relative to `root`. */
  out: string
  /**
   * Where other files under a source directory go, relative to `root`. The
   * build publishes `publicDir`, not `srcDir`, so assets land there.
   */
  publicDir?: string
  /** Convert only this format. Without it the file extension decides. */
  from?: ImportFormat
  /** Overwrite files that already exist in `out`. */
  force?: boolean
}

export interface ImportDiagnostic {
  code: string
  severity: 'info' | 'warning' | 'error'
  fidelity: MigrationDiagnostic['fidelity']
  message: string
  /** 1-based; in the source file, or in the written page when `inOutput` is set. */
  line?: number
  /** Node path in the HTML source. */
  path?: string
  inOutput?: boolean
}

export interface ImportedPage {
  source: string
  output: string
  format: ImportFormat
  diagnostics: ImportDiagnostic[]
}

export interface ImportReport {
  pages: ImportedPage[]
  /** Other files under a source directory, copied into `publicDir`. */
  assets: string[]
  /** Files left alone, with the reason. */
  skipped: Array<{ path: string; reason: string }>
}

const FORMAT_BY_EXTENSION: Record<string, ImportFormat> = {
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.html': 'html',
  '.htm': 'html',
}

const LINKED_SOURCE = /\.(md|markdown|html?)(?:[#?].*)?$/i

function slash(path: string): string {
  return path.split(sep).join('/')
}

async function walk(dir: string, out: string[]): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const full = resolve(dir, entry.name)
    if (entry.isDirectory()) await walk(full, out)
    else if (entry.isFile()) out.push(full)
  }
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  )
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

/**
 * A whole HTML page carries site chrome around the content. The first
 * `<main>`, else `<article>`, else `<body>` is taken as the page body, and
 * `<title>` is kept for a page that ends up without an H1.
 */
function elementInner(html: string, tag: string): string | undefined {
  const open = new RegExp(`<${tag}\\b[^>]*>`, 'i').exec(html)
  if (open === null) return undefined
  const tags = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi')
  tags.lastIndex = open.index + open[0].length
  let depth = 1
  for (let match = tags.exec(html); match !== null; match = tags.exec(html)) {
    depth += match[1] === '/' ? -1 : 1
    if (depth === 0) return html.slice(open.index + open[0].length, match.index)
  }
  return undefined
}

export function htmlContent(html: string): { body: string; title?: string } {
  const raw = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]
  const title = raw === undefined ? undefined : decodeEntities(raw).replace(/\s+/g, ' ').trim()
  for (const tag of ['main', 'article', 'body']) {
    const body = elementInner(html, tag)
    if (body !== undefined) return { body, title }
  }
  return { body: html, title }
}

interface AnyNode {
  type?: string
  level?: number
  href?: string
  src?: string
  pos?: { startLine?: number }
}

function isLocal(target: string): boolean {
  return !/^[a-z][a-z0-9+.-]*:/i.test(target) && !target.startsWith('//') && !target.startsWith('#')
}

function nodes(value: unknown, visit: (node: AnyNode) => void): void {
  if (value === null || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const item of value) nodes(item, visit)
    return
  }
  const node = value as AnyNode
  if (typeof node.type === 'string') visit(node)
  for (const [key, child] of Object.entries(value)) {
    if (key !== 'pos' && key !== 'attrs') nodes(child, visit)
  }
}

/**
 * Findings CarvePress adds on top of the engine's own report. `dir` is the
 * page's directory as a URL path, for spelling a relative image root-relative.
 */
function siteDiagnostics(carve: string, dir: string): { diagnostics: ImportDiagnostic[]; hasH1: boolean } {
  const diagnostics: ImportDiagnostic[] = []
  let hasH1 = false
  nodes(parse(carve), (node) => {
    if (node.type === 'heading' && node.level === 1) hasH1 = true
    if (node.type === 'image' && node.src !== undefined && isLocal(node.src) && !node.src.startsWith('/')) {
      const absolute = posix.normalize(posix.join(dir, node.src.split(/[?#]/)[0]!))
      diagnostics.push({
        code: 'relative-image',
        severity: 'warning',
        fidelity: 'degraded',
        message: `image ${node.src} is relative; CarvePress publishes images from publicDir by root path, so write ${absolute}`,
        line: node.pos?.startLine,
        inOutput: true,
      })
    }
    if (node.type !== 'link' || node.href === undefined) return
    const href = node.href
    if (!isLocal(href)) return
    if (!LINKED_SOURCE.test(href)) return
    diagnostics.push({
      code: 'link-to-source-file',
      severity: 'warning',
      fidelity: 'degraded',
      message: `link ${href} names a source file; CarvePress routes have no extension, so point it at the route`,
      line: node.pos?.startLine,
      inOutput: true,
    })
  })
  return { diagnostics, hasH1 }
}

function fromEngine(diagnostic: MigrationDiagnostic): ImportDiagnostic {
  return {
    code: diagnostic.code,
    severity: diagnostic.severity,
    fidelity: diagnostic.fidelity,
    message: diagnostic.message,
    ...(diagnostic.line === undefined ? {} : { line: diagnostic.line }),
    ...(diagnostic.path === undefined ? {} : { path: diagnostic.path }),
  }
}

export function convertPage(
  text: string,
  format: ImportFormat,
  dir = '/',
): { carve: string; diagnostics: ImportDiagnostic[] } {
  let carve: string
  let diagnostics: ImportDiagnostic[]
  let title: string | undefined
  if (format === 'markdown') {
    const result = migrateMarkdown(text)
    carve = result.value
    diagnostics = result.report.diagnostics.map(fromEngine)
  } else {
    const content = htmlContent(text)
    const result = migrateHtml(content.body)
    carve = result.value
    diagnostics = result.report.diagnostics.map(fromEngine)
    title = content.title
  }
  const site = siteDiagnostics(carve, dir)
  if (!site.hasH1 && title !== undefined && title !== '' && !carve.startsWith('---')) {
    carve = `---yaml\n${stringify({ title }).trimEnd()}\n---\n\n${carve}`
    diagnostics.push({
      code: 'title-from-html-title',
      severity: 'info',
      fidelity: 'normalized',
      message: 'the page has no H1, so its <title> became the frontmatter title',
    })
  }
  return { carve, diagnostics: [...diagnostics, ...siteDiagnostics(carve, dir).diagnostics] }
}

/**
 * Converts Markdown or HTML into `.crv` pages under `out`, keeping the
 * directory layout. Nothing in `out` is overwritten without `force`.
 */
export async function importSite(opts: ImportOptions): Promise<ImportReport> {
  const sourcePath = resolve(opts.root, opts.source)
  const outDir = resolve(opts.root, opts.out)
  const publicDir = resolve(opts.root, opts.publicDir ?? 'public')
  let info
  try {
    info = await stat(sourcePath)
  } catch {
    throw new BuildError(`import: no such file or directory: ${opts.source}`)
  }
  const isDirectory = info.isDirectory()
  const files: string[] = []
  if (isDirectory) await walk(sourcePath, files)
  else files.push(sourcePath)
  files.sort()

  const report: ImportReport = { pages: [], assets: [], skipped: [] }
  for (const file of files) {
    const rel = slash(relative(opts.root, file))
    const inner = isDirectory ? relative(sourcePath, file) : basename(file)
    if (resolve(file).startsWith(outDir + sep) || resolve(file).startsWith(publicDir + sep)) {
      report.skipped.push({ path: rel, reason: 'inside the output or public directory' })
      continue
    }
    const detected = FORMAT_BY_EXTENSION[extname(file).toLowerCase()]
    if (!isDirectory && detected !== undefined && opts.from !== undefined && detected !== opts.from) {
      throw new BuildError(`import: ${opts.source} is ${detected}, not ${opts.from}`)
    }
    const format = isDirectory ? detected : (opts.from ?? detected)

    if (format === undefined || (opts.from !== undefined && format !== opts.from)) {
      if (!isDirectory) {
        throw new BuildError(`import: cannot tell the format of ${opts.source}; pass --from markdown or --from html`)
      }
      if (detected !== undefined) {
        report.skipped.push({ path: rel, reason: `not ${opts.from}` })
        continue
      }
      const target = resolve(publicDir, inner)
      if (!opts.force && (await exists(target))) {
        report.skipped.push({ path: rel, reason: `${slash(relative(opts.root, target))} exists` })
        continue
      }
      await mkdir(dirname(target), { recursive: true })
      await copyFile(file, target)
      report.assets.push(slash(relative(opts.root, target)))
      continue
    }

    const target = resolve(outDir, inner.slice(0, inner.length - extname(inner).length) + '.crv')
    const output = slash(relative(opts.root, target))
    if (!opts.force && (await exists(target))) {
      report.skipped.push({ path: rel, reason: `${output} exists` })
      continue
    }
    let text: string
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(file))
    } catch {
      report.skipped.push({ path: rel, reason: 'not valid UTF-8; re-encode it and import again' })
      continue
    }
    const pageDir = posix.join('/', slash(dirname(inner)))
    const { carve, diagnostics } = convertPage(text, format, pageDir)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, carve, 'utf8')
    report.pages.push({ source: rel, output, format, diagnostics })
  }
  return report
}

/** One line per finding, then a count, for the terminal. */
export function formatImportReport(report: ImportReport): string[] {
  const lines: string[] = []
  let unverified = false
  let losses = 0
  for (const page of report.pages) {
    for (const d of page.diagnostics) {
      // The engine attaches this to every Markdown page; it says the report is
      // not exhaustive, which is one note, not one line per page.
      if (d.code === 'fidelity-unverified') {
        unverified = true
        continue
      }
      if (d.fidelity === 'dropped' || d.fidelity === 'degraded') losses += 1
      if (d.severity === 'info' && d.fidelity !== 'dropped') continue
      const file = d.inOutput === true ? page.output : page.source
      const at = d.line === undefined ? '' : `:${d.line}`
      lines.push(`${file}${at} ${d.code} (${d.fidelity}) - ${d.message}`)
    }
  }
  for (const skipped of report.skipped) lines.push(`${skipped.path} skipped - ${skipped.reason}`)
  if (unverified) {
    lines.push('carve-press: the Markdown importer does not assess every construct; review the converted pages')
  }
  lines.push(
    `carve-press: imported ${report.pages.length} page(s), copied ${report.assets.length} file(s), skipped ${report.skipped.length}; ${losses} finding(s) lost or degraded content`,
  )
  return lines
}
