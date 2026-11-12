import { readFileSync } from 'node:fs'
import * as nodeModule from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Node picks a `.ts` file's format from the nearest package.json `type`, so a
// config in a `"type": "commonjs"` package (npm 12's `npm init -y`) loads as
// CommonJS and fails on its first `import` (#114). The config and the `.ts`
// files it imports relatively are always ES modules.
const esmUrls = new Set<string>()
let registered = false

function bare(url: string): string {
  return url.replace(/[?#].*$/, '')
}

function isProjectTypeScript(url: string): boolean {
  return url.startsWith('file:') && url.endsWith('.ts') && !url.includes('/node_modules/')
}

export async function importConfig(path: string, href: string): Promise<unknown> {
  if (path.endsWith('.ts')) registerEsmHooks(pathToFileURL(path).href)
  return import(href)
}

function registerEsmHooks(url: string): void {
  esmUrls.add(url)
  // Node 20 has no registerHooks and cannot load a `.ts` config either way.
  if (registered || typeof nodeModule.registerHooks !== 'function') return
  registered = true
  nodeModule.registerHooks({
    resolve(specifier, context, nextResolve) {
      const result = nextResolve(specifier, context)
      const parent = context.parentURL === undefined ? undefined : bare(context.parentURL)
      if (parent !== undefined && esmUrls.has(parent) && isProjectTypeScript(bare(result.url))) {
        esmUrls.add(bare(result.url))
      }
      return result
    },
    load(url, context, nextLoad) {
      const file = bare(url)
      if (!esmUrls.has(file)) return nextLoad(url, context)
      return { format: 'module-typescript', source: readFileSync(fileURLToPath(file)), shortCircuit: true }
    },
  })
}
