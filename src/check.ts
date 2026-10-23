import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildSite } from './build.js'
import type { UserConfig } from './config.js'

export interface CheckResult {
  routes: string[]
}

/**
 * Runs the whole build - render, lint, link, nav and route-manifest checks -
 * into a throwaway directory, so nothing in the project changes. Every
 * failure a build would raise is raised here.
 */
export async function checkSite(opts: { root: string; config: UserConfig }): Promise<CheckResult> {
  const outDir = await mkdtemp(join(tmpdir(), 'carve-press-check-'))
  try {
    const result = await buildSite({
      root: opts.root,
      config: { ...opts.config, outDir },
      writeManifest: false,
    })
    return { routes: result.routes }
  } finally {
    await rm(outDir, { recursive: true, force: true })
  }
}
