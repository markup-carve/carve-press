import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { initSite, newPage } from '../src/scaffold.js'

describe('initSite', () => {
  it('scaffolds a starter site and appends dist to an existing gitignore', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'cp-init-'))
    await writeFile(resolve(root, '.gitignore'), 'node_modules/\n')

    const result = await initSite(root)

    expect(result.files).toContain('carve-press.config.ts')
    await expect(readFile(resolve(root, 'docs/index.crv'), 'utf8')).resolves.toContain('layout: home')
    await expect(readFile(resolve(root, 'docs/guide/getting-started.crv'), 'utf8')).resolves.toContain(
      '# Getting Started',
    )
    await expect(readFile(resolve(root, 'public/.gitkeep'), 'utf8')).resolves.toBe('')
    await expect(readFile(resolve(root, '.gitignore'), 'utf8')).resolves.toContain('dist/')
  })

  it('refuses to overwrite existing scaffold files unless forced', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'cp-init-overwrite-'))
    await mkdir(resolve(root, 'docs'), { recursive: true })
    await writeFile(resolve(root, 'docs/index.crv'), 'existing')

    await expect(initSite(root)).rejects.toThrow(/docs\/index\.crv/)
    await expect(initSite(root, { force: true })).resolves.toMatchObject({ files: expect.any(Array) })
    await expect(readFile(resolve(root, 'docs/index.crv'), 'utf8')).resolves.toContain('layout: home')
  })
})

describe('newPage', () => {
  it('creates a page under the resolved srcDir and prints the route', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'cp-new-'))
    await writeFile(
      resolve(root, 'carve-press.config.js'),
      "export default { title: 'Docs', srcDir: 'content' }\n",
    )

    const result = await newPage(root, 'guide/routing')

    expect(result.route).toBe('/guide/routing')
    await expect(readFile(resolve(root, 'content/guide/routing.crv'), 'utf8')).resolves.toContain(
      'title: Routing',
    )
  })

  it('uses an explicit title and refuses to overwrite', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'cp-new-title-'))
    await writeFile(resolve(root, 'carve-press.config.js'), "export default { title: 'Docs' }\n")

    await expect(newPage(root, 'guide/api', { title: 'API Reference' })).resolves.toMatchObject({
      route: '/guide/api',
    })
    await expect(readFile(resolve(root, 'docs/guide/api.crv'), 'utf8')).resolves.toContain(
      '# API Reference',
    )
    await expect(newPage(root, 'guide/api')).rejects.toThrow(/page already exists/)
  })
})
