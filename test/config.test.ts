import { describe, it, expect } from 'vitest'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import type { LanguageRegistration } from '@shikijs/types'
import { resolveConfig } from '../src/config.js'

const customGrammar = {
  name: 'custom',
  scopeName: 'source.custom',
  patterns: [{ name: 'keyword.custom', match: '\\bCUSTOM\\b' }],
} satisfies LanguageRegistration

describe('resolveConfig', () => {
  it('applies defaults for every omitted field', () => {
    const c = resolveConfig({ title: 'Carve' })
    expect(c.title).toBe('Carve')
    expect(c.base).toBe('/')
    expect(c.srcDir).toBe('docs')
    expect(c.outDir).toBe('dist')
    expect(c.publicDir).toBe('public')
    expect(c.cleanUrls).toBe(true)
    expect(c.srcExclude).toEqual([])
    expect(c.head).toEqual([])
    expect(c.theme).toEqual({})
    expect(c.themeConfig.nav).toEqual([])
    expect(c.themeConfig.sidebar).toEqual({})
    expect(c.themeConfig.outline.level).toEqual([2, 3])
    expect(c.carve.extensions).toEqual([])
    expect(c.shiki.langs).toEqual([
      'carve',
      'html',
      'bash',
      'php',
      'ts',
      'js',
      'go',
      'python',
      'rust',
      'json',
      'yaml',
      'toml',
      'md',
      'txt',
      'diff',
      'css',
      'sql',
      'xml',
    ])
    expect(c.shiki.themes).toEqual({ light: 'github-light', dark: 'github-dark' })
    expect(c.search).toEqual({ filename: 'search-index.json', exclude: [] })
    expect(c.extensions.map((extension) => extension.name)).toEqual(['search-index'])
  })

  it('can disable the default search extension', () => {
    const c = resolveConfig({ title: 'Carve', search: false })
    expect(c.search).toBe(false)
    expect(c.extensions).toEqual([])
  })

  it('resolves user Shiki themes over defaults and adds user languages to them', () => {
    // A theme is a single choice, so the user's replaces the default. A language
    // list is a set, and replacing it silently stripped highlighting from every
    // default language the site never meant to drop.
    const c = resolveConfig({
      title: 'Carve',
      shiki: { langs: ['c'], themes: { dark: 'dracula' } },
    })
    expect(c.shiki.langs).toContain('c')
    expect(c.shiki.langs).toContain('carve')
    expect(c.shiki.themes).toEqual({ light: 'github-light', dark: 'dracula' })
  })

  it('normalizes base to a leading and trailing slash', () => {
    // A base written any of the four ways must resolve identically, because
    // every emitted URL is built by concatenation.
    expect(resolveConfig({ title: 'x', base: 'carve' }).base).toBe('/carve/')
    expect(resolveConfig({ title: 'x', base: '/carve' }).base).toBe('/carve/')
    expect(resolveConfig({ title: 'x', base: 'carve/' }).base).toBe('/carve/')
    expect(resolveConfig({ title: 'x', base: '/carve/' }).base).toBe('/carve/')
  })

  it('rejects a config with no title', () => {
    // @ts-expect-error deliberately invalid at runtime
    expect(() => resolveConfig({})).toThrow(/title is required/)
  })

  it('resolves configured playground paths relative to the site root', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'cp-config-playground-'))
    await mkdir(resolve(root, 'runtime/carve-wasm'), { recursive: true })
    await writeFile(resolve(root, 'runtime/mermaid.js'), 'window.mermaid = {}\n')
    await writeFile(resolve(root, 'runtime/chart.js'), 'window.Chart = function Chart() {}\n')

    const config = resolveConfig(
      {
        title: 'Carve',
        playground: {
          wasmEngine: 'runtime/carve-wasm',
          mermaid: 'runtime/mermaid.js',
          chart: 'runtime/chart.js',
        },
      },
      root,
    )

    expect(config.playground).toEqual({
      wasmEngine: resolve(root, 'runtime/carve-wasm'),
      mermaid: resolve(root, 'runtime/mermaid.js'),
      chart: resolve(root, 'runtime/chart.js'),
    })
  })

  it('rejects a configured missing playground path with the key and resolved path', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'cp-config-playground-missing-'))
    const missing = resolve(root, 'runtime/missing-wasm')

    expect(() =>
      resolveConfig({ title: 'Carve', playground: { wasmEngine: 'runtime/missing-wasm' } }, root),
    ).toThrow(new RegExp(`playground\\.wasmEngine.*${missing.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
  })
})

describe('shiki languages', () => {
  it('keeps a mix of bundled language names and custom registrations', () => {
    const config = resolveConfig({ title: 'T', shiki: { langs: ['ruby', customGrammar] } }, '/root')

    expect(config.shiki.langs).toContain('ruby')
    expect(config.shiki.langs).toContain(customGrammar)
  })

  it('adds the user languages to the defaults rather than replacing them', () => {
    // Replacing was the old behavior and it failed quietly: the build still
    // succeeded and every fence in a default language silently lost its
    // highlighting.
    const config = resolveConfig({ title: 'T', shiki: { langs: ['textile'] } }, '/root')

    expect(config.shiki.langs).toContain('textile')
    expect(config.shiki.langs).toContain('carve')
    expect(config.shiki.langs).toContain('html')
  })

  it('does not duplicate a language the defaults already cover', () => {
    const config = resolveConfig({ title: 'T', shiki: { langs: ['html'] } }, '/root')

    expect(config.shiki.langs.filter((lang) => lang === 'html')).toHaveLength(1)
  })

  it('replaces a default bundled language with a user registration of the same name', () => {
    const htmlGrammar = { ...customGrammar, name: 'html', scopeName: 'source.custom-html' } satisfies LanguageRegistration
    const config = resolveConfig({ title: 'T', shiki: { langs: [htmlGrammar] } }, '/root')

    expect(config.shiki.langs).toContain(htmlGrammar)
    expect(config.shiki.langs.filter((lang) => (typeof lang === 'string' ? lang : lang.name) === 'html')).toHaveLength(1)
    expect(config.shiki.langs).not.toContain('html')
  })

  it('keeps default languages when the user supplies only a registration object', () => {
    const config = resolveConfig({ title: 'T', shiki: { langs: [customGrammar] } }, '/root')

    expect(config.shiki.langs).toContain(customGrammar)
    expect(config.shiki.langs).toContain('carve')
    expect(config.shiki.langs).toContain('html')
  })
})
