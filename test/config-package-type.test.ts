import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import * as nodeModule from 'node:module'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const repo = resolve(import.meta.dirname, '..')
const cli = resolve(repo, 'dist/cli.js')

// Node 20 cannot load a `.ts` config at all.
const loadsTypeScript =
  (process.features as { typescript?: unknown }).typescript !== undefined &&
  (process.features as { typescript?: unknown }).typescript !== false &&
  typeof nodeModule.registerHooks === 'function'

async function project(packageJson: Record<string, unknown>): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'cp-pkg-type-'))
  await writeFile(resolve(root, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`)
  await mkdir(resolve(root, 'node_modules/@markup-carve'), { recursive: true })
  await symlink(repo, resolve(root, 'node_modules/@markup-carve/carve-press'), 'dir')
  return root
}

async function press(root: string, ...args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(process.execPath, [cli, ...args], { cwd: root })
}

describe.skipIf(!loadsTypeScript)('init then build in a fresh npm project (#114)', () => {
  // `npm init -y` on npm 12 writes "type": "commonjs".
  it.each([
    ['"type": "commonjs"', { name: 'site', version: '1.0.0', type: 'commonjs' }],
    ['no type field', { name: 'site', version: '1.0.0' }],
    ['"type": "module"', { name: 'site', version: '1.0.0', type: 'module' }],
  ])('builds the scaffolded config with %s', async (_label, packageJson) => {
    const root = await project(packageJson)

    await press(root, 'init')
    const { stdout, stderr } = await press(root, 'build')

    expect(stdout).toMatch(/built 2 page\(s\) \(2 rendered, 0 from cache\) into \S*\/dist in \d+ms/)
    expect(stderr).not.toMatch(/MODULE_TYPELESS_PACKAGE_JSON|Failed to load the ES module/)
  }, 60_000)

  it('loads relative TypeScript imports of the config as ES modules', async () => {
    const root = await project({ name: 'site', version: '1.0.0', type: 'commonjs' })
    await press(root, 'init')
    await writeFile(resolve(root, 'site-title.ts'), "export const title: string = 'Split Config'\n")
    await writeFile(
      resolve(root, 'carve-press.config.ts'),
      "import { defineConfig } from '@markup-carve/carve-press'\n" +
        "import { title } from './site-title.ts'\n\n" +
        'export default defineConfig({ title })\n',
    )

    const { stdout } = await press(root, 'build')

    expect(stdout).toMatch(/built 2 page\(s\)/)
  }, 60_000)
})
