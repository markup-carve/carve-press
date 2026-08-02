#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { buildSite, loadConfig } from './build.js'
import { resolveConfig } from './config.js'
import { discoverPages } from './content/discover.js'
import { startDevServer, formatCliError } from './dev.js'
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
  const valueFlags = new Set(['--root', '--port', '--host', '--title'])
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

async function commandRoutes(root: string): Promise<void> {
  const config = resolveConfig(await loadConfig(root))
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
  const config = resolveConfig(await loadConfig(root))
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
