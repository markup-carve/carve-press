import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * What an `exports` map does is decided by Node's resolver, against an
 * INSTALLED package. Reading this repository's own manifest with `readFileSync`
 * and asserting a key is present answers a different question - "what does the
 * file say" - and such an assertion passes just as happily with the entry
 * deleted. carve-js had exactly that test and it did (markup-carve/carve-js#1260).
 *
 * So this file asks the resolver instead. A scratch directory gets the
 * `node_modules` layout an install produces, this package is linked into it,
 * and a real `node` reads the specifier back from that directory the way a
 * consumer's CI step would.
 *
 * The link points at the repository root, so `tsconfig.json` and `src/` are
 * present on disk under the installed name. That is what makes the
 * encapsulation assertion below mean something: those paths are reachable and
 * still have to be refused.
 */

const root = resolve(import.meta.dirname, '..')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  name: string
  version: string
}

describe('resolving a subpath from a consumer position', () => {
  let consumer: string

  beforeAll(() => {
    consumer = mkdtempSync(join(tmpdir(), 'carve-press-consumer-'))
    mkdirSync(join(consumer, 'node_modules', '@markup-carve'), { recursive: true })
    symlinkSync(root, join(consumer, 'node_modules', '@markup-carve', 'carve-press'), 'dir')
  })

  afterAll(() => rmSync(consumer, { recursive: true, force: true }))

  const run = (script: string): string =>
    execFileSync(process.execPath, ['-e', script], {
      cwd: consumer,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()

  // Probed with `import`, not `require`: `.` names an `import` condition and no
  // `require` one, so a require probe would answer ERR_PACKAGE_PATH_NOT_EXPORTED
  // for a subpath that is wide open, and the two failures would look identical.
  const codeOf = (specifier: string): string =>
    run(
      `import(${JSON.stringify(specifier)}).then(() => console.log('RESOLVED'),` +
        ` (e) => console.log(e.code ?? String(e)))`,
    )

  it('reads the installed version back through the package specifier', () => {
    // The question a version-pinning CI step asks. Closed, it throws
    // ERR_PACKAGE_PATH_NOT_EXPORTED, which reads as "this package is not
    // installed" rather than "this subpath is closed" - so whoever hits it
    // audits their install before suspecting a manifest, and writes a
    // filesystem path read instead, which is more fragile than the version
    // check it implements.
    const version = run(
      `console.log(require(${JSON.stringify(`${manifest.name}/package.json`)}).version)`,
    )

    expect(version).toBe(manifest.version)
  })

  it('reads it back under import as well as require', () => {
    // Both resolvers consult the same map, but only one of them is what a given
    // shell one-liner in CI happens to use.
    const version = run(
      `import(${JSON.stringify(`${manifest.name}/package.json`)}, { with: { type: 'json' } })` +
        `.then((m) => console.log(m.default.version))`,
    )

    expect(version).toBe(manifest.version)
  })

  it('opens that one file and not the directory holding it', () => {
    // The failure this guards: widening the map with a `./*` wildcard to fix
    // the two above. That publishes the whole checkout as importable API -
    // `src/` included - and nothing else here would notice.
    expect(codeOf(`${manifest.name}/tsconfig.json`)).toBe('ERR_PACKAGE_PATH_NOT_EXPORTED')
    expect(codeOf(`${manifest.name}/src/index.ts`)).toBe('ERR_PACKAGE_PATH_NOT_EXPORTED')
    expect(codeOf(`${manifest.name}/dist/index.js`)).toBe('ERR_PACKAGE_PATH_NOT_EXPORTED')
  })

  it('still resolves the entry point the map already named', () => {
    expect(codeOf(manifest.name)).toBe('RESOLVED')
  })
})
