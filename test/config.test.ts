import { describe, it, expect } from 'vitest'
import { resolveConfig } from '../src/config.js'

describe('resolveConfig', () => {
  it('applies defaults for every omitted field', () => {
    const c = resolveConfig({ title: 'Carve' })
    expect(c.title).toBe('Carve')
    expect(c.base).toBe('/')
    expect(c.srcDir).toBe('docs')
    expect(c.outDir).toBe('dist')
    expect(c.cleanUrls).toBe(true)
    expect(c.srcExclude).toEqual([])
    expect(c.head).toEqual([])
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
    expect(c.extensions).toEqual([])
  })

  it('resolves user Shiki settings over defaults', () => {
    const c = resolveConfig({
      title: 'Carve',
      shiki: { langs: ['carve', 'c'], themes: { dark: 'dracula' } },
    })
    expect(c.shiki.langs).toEqual(['carve', 'c'])
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
})
