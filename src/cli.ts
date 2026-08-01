#!/usr/bin/env node
import { resolve } from 'node:path'
import { buildSite, loadConfig } from './build.js'
import { resolveConfig } from './config.js'
import { discoverPages } from './content/discover.js'
import { BuildError, SourceError } from './errors.js'

function argValue(argv: string[], flag: string, fallback: string): string {
  const index = argv.indexOf(flag)
  return index === -1 ? fallback : (argv[index + 1] ?? fallback)
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

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const command = argv[0] ?? 'build'
  const root = resolve(argValue(argv, '--root', process.cwd()))

  if (command === 'build') return commandBuild(root)
  if (command === 'routes') return commandRoutes(root)

  console.error(`carve-press: unknown command "${command}"`)
  console.error('usage: carve-press <build|routes> [--root <dir>]')
  process.exitCode = 1
}

main().catch((error: unknown) => {
  // A raw stack trace is never the right thing to show a docs author.
  if (error instanceof SourceError || error instanceof BuildError) {
    console.error(`carve-press: ${error.format()}`)
  } else {
    console.error(`carve-press: ${error instanceof Error ? error.message : String(error)}`)
  }
  process.exitCode = 1
})
