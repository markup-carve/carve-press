#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { buildSite, loadConfig } from './build.js'
import { checkSite } from './check.js'
import { resolveConfig } from './config.js'
import { discoverPages } from './content/discover.js'
import { startDevServer, formatCliError } from './dev.js'
import { formatSources } from './fmt.js'
import { formatImportReport, importSite, type ImportFormat } from './import.js'
import { initSite, newPage } from './scaffold.js'
import { startStaticServer } from './server.js'

const require = createRequire(import.meta.url)

interface PackageJson {
  version: string
}

function usage(): string {
  return `usage: carve-press <command> [options]

Commands:
  build                         Build the site
  check                         Validate and lint without writing a build
  fmt [paths...]                Format .crv sources (default: srcDir)
  import <source>               Convert Markdown or HTML pages to .crv
  routes                        Print discovered routes
  dev [--open]                  Build, serve, watch, and live reload
  serve                         Serve the existing outDir
  init [--force]                Scaffold a new site
  new <path> [--title <title>]  Create a new page under srcDir
  help                          Print this help

Options:
  --root <dir>                  Project root
  --port <n>                    Server port
  --host <host>                 Server host
  --open                        Open the dev server in a browser
  --force                       Allow init to overwrite scaffold files
  --title <title>               Page title for new
  --check                       fmt: list unformatted files, exit 1 if any
  --align-tables                fmt: pad table columns to a shared width
  --out <dir>                   import: target directory (default: srcDir)
  --from <markdown|html>        import: only convert this format
  --report <file>               import: write the full report as JSON
  --force                       import: overwrite existing files
  --help                        Print this help
  --version                     Print the package version`
}

function argValue(argv: string[], flag: string, fallback: string): string {
  const index = argv.indexOf(flag)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
}

function hasFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag)
}

function portValue(argv: string[], fallback: number): number {
  const raw = argValue(argv, '--port', String(fallback))
  const port = Number(raw)
  return Number.isInteger(port) && port >= 0 && port <= 65535 ? port : fallback
}

function positionalArgs(argv: string[]): string[] {
  const positional: string[] = []
  const valueFlags = new Set(['--root', '--port', '--host', '--title', '--out', '--from', '--report'])
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i]!
    if (valueFlags.has(arg)) {
      i += 1
      continue
    }
    if (!arg.startsWith('--')) positional.push(arg)
  }
  return positional
}

async function commandBuild(root: string): Promise<void> {
  const config = await loadConfig(root)
  const started = Date.now()
  const result = await buildSite({ root, config })
  console.log(
    `carve-press: built ${result.routes.length} page(s) into ${result.outDir} in ${
      Date.now() - started
    }ms`,
  )
}

async function commandCheck(root: string): Promise<void> {
  const config = await loadConfig(root)
  const started = Date.now()
  const result = await checkSite({ root, config })
  console.log(
    `carve-press: checked ${result.routes.length} page(s) in ${Date.now() - started}ms, no problems found`,
  )
}

async function commandFmt(root: string, argv: string[]): Promise<void> {
  const check = hasFlag(argv, '--check')
  const result = await formatSources({
    root,
    paths: positionalArgs(argv),
    check,
    alignTables: hasFlag(argv, '--align-tables'),
  })
  for (const file of result.changed) console.log(check ? file : `formatted ${file}`)
  for (const error of result.errors) console.error(`carve-press: fmt: ${error}`)
  if (check && result.changed.length > 0) {
    console.error(`carve-press: ${result.changed.length} of ${result.files.length} file(s) need formatting`)
    process.exitCode = 1
  }
  if (result.errors.length > 0) process.exitCode = 2
}

async function commandImport(root: string, argv: string[]): Promise<void> {
  const source = positionalArgs(argv)[0]
  const from = argv.includes('--from') ? argValue(argv, '--from', '') : undefined
  if (source === undefined || (from !== undefined && from !== 'markdown' && from !== 'html')) {
    console.error('carve-press: import requires a source path, and --from takes markdown or html')
    console.error(usage())
    process.exitCode = 1
    return
  }
  let out = argv.includes('--out') ? argValue(argv, '--out', '') : undefined
  if (out === undefined) {
    // No config yet is the normal state before a migration; a broken one is not.
    const config = await loadConfig(root).catch((error: unknown) => {
      if (error instanceof Error && error.message.startsWith('no carve-press.config')) return undefined
      throw error
    })
    out = config === undefined ? 'docs' : resolveConfig(config, root).srcDir
  }
  const report = await importSite({
    root,
    source,
    out,
    from: from as ImportFormat | undefined,
    force: hasFlag(argv, '--force'),
  })
  for (const line of formatImportReport(report)) console.log(line)
  if (argv.includes('--report')) {
    const reportPath = resolve(root, argValue(argv, '--report', 'carve-import-report.json'))
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    console.log(`carve-press: wrote the import report to ${reportPath}`)
  }
}

async function commandRoutes(root: string): Promise<void> {
  const config = resolveConfig(await loadConfig(root), root)
  const pages = await discoverPages(resolve(root, config.srcDir), config.srcExclude)
  const width = Math.max(...pages.map((p) => p.route.length), 5)
  console.log(`${'ROUTE'.padEnd(width)}  SOURCE`)
  for (const page of pages) console.log(`${page.route.padEnd(width)}  ${page.relPath}`)
}

function openBrowser(url: string): void {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  const child = spawn(command, args, { detached: true, stdio: 'ignore' })
  child.unref()
}

async function waitForExit(close: () => Promise<void>): Promise<void> {
  await new Promise<void>((resolveWait) => {
    function done(): void {
      process.off('SIGINT', done)
      process.off('SIGTERM', done)
      resolveWait()
    }
    process.once('SIGINT', done)
    process.once('SIGTERM', done)
  })
  await close()
}

async function commandServe(root: string, argv: string[]): Promise<void> {
  const config = resolveConfig(await loadConfig(root), root)
  const outDir = resolve(root, config.outDir)
  const running = await startStaticServer({
    outDir,
    config,
    port: portValue(argv, 4173),
    host: argValue(argv, '--host', '127.0.0.1'),
  })
  console.log(`carve-press: serving ${outDir} at ${running.url}${config.base}`)
  await waitForExit(running.close)
}

async function commandDev(root: string, argv: string[]): Promise<void> {
  const running = await startDevServer({
    root,
    port: portValue(argv, 5173),
    host: argValue(argv, '--host', '127.0.0.1'),
  })
  console.log(`carve-press: dev server running at ${running.url}`)
  if (hasFlag(argv, '--open')) openBrowser(running.url)
  await waitForExit(running.close)
}

async function commandInit(root: string, argv: string[]): Promise<void> {
  const result = await initSite(root, { force: hasFlag(argv, '--force') })
  console.log(`carve-press: initialized ${result.files.length} file(s) in ${root}`)
}

async function commandNew(root: string, argv: string[]): Promise<void> {
  const pagePath = positionalArgs(argv)[0]
  if (pagePath === undefined) {
    console.error('carve-press: new requires a path')
    console.error(usage())
    process.exitCode = 1
    return
  }
  const title = argv.includes('--title') ? argValue(argv, '--title', '') : undefined
  const result = await newPage(root, pagePath, { title })
  console.log(`carve-press: created ${result.path}`)
  console.log(`carve-press: route ${result.route}`)
}

async function main(): Promise<void> {
  const rawArgv = process.argv.slice(2)
  const command = rawArgv[0]?.startsWith('--') === true ? 'build' : (rawArgv[0] ?? 'build')
  const argv = command === 'build' && rawArgv[0]?.startsWith('--') === true ? ['build', ...rawArgv] : rawArgv
  const root = resolve(argValue(argv, '--root', process.cwd()))

  if (hasFlag(rawArgv, '--help') || command === 'help') {
    console.log(usage())
    return
  }
  if (hasFlag(rawArgv, '--version')) {
    console.log((require('../package.json') as PackageJson).version)
    return
  }

  if (command === 'build') return commandBuild(root)
  if (command === 'check') return commandCheck(root)
  if (command === 'fmt') return commandFmt(root, argv)
  if (command === 'import') return commandImport(root, argv)
  if (command === 'routes') return commandRoutes(root)
  if (command === 'serve') return commandServe(root, argv)
  if (command === 'dev') return commandDev(root, argv)
  if (command === 'init') return commandInit(root, argv)
  if (command === 'new') return commandNew(root, argv)

  console.error(`carve-press: unknown command "${command}"`)
  console.error(usage())
  process.exitCode = 1
}

main().catch((error: unknown) => {
  // A raw stack trace is never the right thing to show a docs author.
  console.error(`carve-press: ${formatCliError(error)}`)
  process.exitCode = 1
})
