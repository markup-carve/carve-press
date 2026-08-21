import { promises as fs } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { loadConfig } from './build.js'
import { resolveConfig } from './config.js'
import { routeForPath } from './content/route.js'
import { BuildError } from './errors.js'

export interface InitResult {
  files: string[]
}

export interface NewPageResult {
  path: string
  route: string
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.stat(path)
    return true
  } catch {
    return false
  }
}

function titleCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

async function writeNewFile(path: string, content: string, force = false): Promise<void> {
  await mkdirFor(path)
  await fs.writeFile(path, content, { encoding: 'utf8', flag: force ? 'w' : 'wx' })
}

async function mkdirFor(path: string): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true })
}

export async function initSite(root: string, opts: { force?: boolean } = {}): Promise<InitResult> {
  const outDir = 'dist'
  const files = [
    'carve-press.config.ts',
    'docs/index.crv',
    'docs/guide/getting-started.crv',
    'public/.gitkeep',
  ]
  const existing = []
  for (const file of files) {
    if (await exists(resolve(root, file))) existing.push(file)
  }
  if (existing.length > 0 && opts.force !== true) {
    throw new BuildError(`init would overwrite existing file(s): ${existing.join(', ')}`, existing)
  }

  await writeNewFile(
    resolve(root, 'carve-press.config.ts'),
    `import { defineConfig } from '@markup-carve/carve-press'

export default defineConfig({
  title: 'CarvePress Site',
  description: 'A CarvePress documentation site',
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'Guide',
          items: [
            { text: 'Getting Started', link: '/guide/getting-started' },
          ],
        },
      ],
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/' },
    ],
    footer: {
      message: 'Built with CarvePress',
      copyright: 'Released under the MIT License',
    },
  },
})
`,
    opts.force === true,
  )
  await writeNewFile(
    resolve(root, 'docs/index.crv'),
    `---
title: CarvePress Site
layout: home
hero:
  name: CarvePress Site
  text: Documentation built with Carve
  tagline: Edit docs/index.crv to start shaping your site.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
features:
  - title: Write in Carve
    details: Compose structured pages with readable plain text.
  - title: Ship static HTML
    details: Build a fast site with no application server.
  - title: Customize the theme
    details: Add navigation, sidebars, social links, and CSS.
---
`,
    opts.force === true,
  )
  await writeNewFile(
    resolve(root, 'docs/guide/getting-started.crv'),
    `---
title: Getting Started
---

# Getting Started

Run \`carve-press dev\` to preview your site locally.
`,
    opts.force === true,
  )
  await writeNewFile(resolve(root, 'public/.gitkeep'), '', opts.force === true)

  const gitignore = resolve(root, '.gitignore')
  if (await exists(gitignore)) {
    const current = await fs.readFile(gitignore, 'utf8')
    const entry = `${outDir}/`
    if (!current.split(/\r?\n/).includes(entry)) {
      await fs.writeFile(gitignore, `${current}${current.endsWith('\n') || current === '' ? '' : '\n'}${entry}\n`)
    }
  }

  return { files }
}

function normalizePagePath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\.crv$/, '')
  if (normalized === '' || normalized.includes('..')) throw new BuildError(`invalid page path "${path}"`)
  return `${normalized}.crv`
}

export async function newPage(
  root: string,
  pagePath: string,
  opts: { title?: string } = {},
): Promise<NewPageResult> {
  const config = resolveConfig(await loadConfig(root), root)
  const relPath = normalizePagePath(pagePath)
  const title = opts.title ?? titleCase(relPath.replace(/\.crv$/, '').split('/').at(-1) ?? 'Page')
  const path = resolve(root, config.srcDir, relPath)
  if (await exists(path)) throw new BuildError(`page already exists: ${path}`)

  await writeNewFile(
    path,
    `---
title: ${title}
---

# ${title}
`,
  )

  return { path, route: routeForPath(relPath) }
}
