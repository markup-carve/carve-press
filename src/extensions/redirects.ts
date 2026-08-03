import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import type { CarvePressConfig, SiteExtension } from '../config.js'
import { outPathForRoute, routeKey } from '../content/route.js'
import { BuildError } from '../errors.js'
import { escapeAttr, escapeText, withBase } from '../layout/shell.js'

function isAbsoluteUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//')
}

function normalizeSource(route: string): string {
  return route.startsWith('/') ? route : `/${route}`
}

function html(source: string, target: string, config: CarvePressConfig): string {
  const href = isAbsoluteUrl(target) ? target : withBase(config.base, target)
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta http-equiv="refresh" content="0; url=${escapeAttr(href)}">
    <link rel="canonical" href="${escapeAttr(href)}">
    <title>Redirecting</title>
  </head>
  <body>
    <p>Redirecting from ${escapeText(source)} to <a href="${escapeAttr(href)}">${escapeText(href)}</a>.</p>
  </body>
</html>
`
}

/**
 * Sources come from config, not from discovered files, so nothing has already
 * vetted them. A `..` segment survives `outPathForRoute` and would write the
 * redirect stub outside the output directory.
 */
function isSiteRoute(source: string): boolean {
  return source.startsWith('/') && !source.split('/').includes('..')
}

export function redirects(entries: Record<string, string>): SiteExtension {
  let config: CarvePressConfig | undefined
  const redirects = Object.entries(entries).map(([source, target]) => [normalizeSource(source), target] as const)
  return {
    name: 'redirects',
    setup(bus) {
      bus.on('buildStarted', (payload) => {
        config = payload.config
      })
      bus.on(
        'contentDiscovered',
        ({ pages }) => {
          const routes = new Set(pages.map((page) => routeKey(page.route)))
          for (const [source, target] of redirects) {
            if (!isSiteRoute(source)) {
              throw new BuildError(
                `redirect source ${source} is not a site route`,
                ['a source must start with / and must not contain ".." segments'],
              )
            }
            if (routes.has(routeKey(source))) throw new BuildError(`redirect source ${source} collides with a page`)
            if (!isAbsoluteUrl(target) && !routes.has(routeKey(target))) {
              throw new BuildError(`redirect target ${target} does not resolve to a page`)
            }
          }
        },
        'redirects',
      )
      bus.on(
        'buildCompleted',
        async ({ outDir }) => {
          if (config === undefined) return
          for (const [source, target] of redirects) {
            const outPath = resolve(outDir, outPathForRoute(source, config.cleanUrls))
            await mkdir(dirname(outPath), { recursive: true })
            await writeFile(outPath, html(source, target, config), 'utf8')
          }
          const lines = redirects.map(([source, target]) => `${source} ${target} 301`)
          await writeFile(resolve(outDir, '_redirects'), `${lines.join('\n')}\n`, 'utf8')
        },
        'redirects',
      )
    },
  }
}

