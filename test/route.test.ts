import { describe, it, expect } from 'vitest'
import { rewriteRoute, routeForPath, outPathForRoute, routeKey } from '../src/content/route.js'

describe('routeForPath', () => {
  it('maps a top-level page to a root route', () => {
    expect(routeForPath('get-started.crv')).toBe('/get-started')
  })

  it('maps index.crv to its directory root', () => {
    expect(routeForPath('index.crv')).toBe('/')
    expect(routeForPath('case-study/index.crv')).toBe('/case-study/')
  })

  it('maps a nested page to a nested route', () => {
    expect(routeForPath('examples/core.crv')).toBe('/examples/core')
  })

  it('normalizes Windows separators', () => {
    expect(routeForPath('examples\\core.crv')).toBe('/examples/core')
  })

  it('does not accept the .carve extension', () => {
    // `.crv` is the only Carve extension: `.carve` was dropped in intellij-carve
    // 0.1.2 with an instruction to rename, and jekyll-carve and mkdocs-carve both
    // assert they do not match it. A `.carve` file is not a page, so its extension
    // stays in the route rather than being stripped.
    expect(routeForPath('page.carve')).toBe('/page.carve')
  })

  it('normalizes a leading ./', () => {
    expect(routeForPath('./get-started.crv')).toBe('/get-started')
  })
})

describe('outPathForRoute', () => {
  it('emits directory-style output for clean URLs', () => {
    expect(outPathForRoute('/get-started', true)).toBe('get-started/index.html')
    expect(outPathForRoute('/', true)).toBe('index.html')
    expect(outPathForRoute('/case-study/', true)).toBe('case-study/index.html')
  })

  it('emits flat .html files when clean URLs are off', () => {
    expect(outPathForRoute('/get-started', false)).toBe('get-started.html')
    expect(outPathForRoute('/', false)).toBe('index.html')
    expect(outPathForRoute('/case-study/', false)).toBe('case-study/index.html')
  })
})

describe('routeKey', () => {
  it('collapses a directory route to its canonical key', () => {
    expect(routeKey('/get-started/')).toBe('/get-started')
    expect(routeKey('/get-started')).toBe('/get-started')
  })

  it('leaves the site root alone', () => {
    expect(routeKey('/')).toBe('/')
  })

  it('gives a page and its same-named index directory the same key', () => {
    // These produce different routes but the same output file under cleanUrls,
    // so duplicate detection has to see them as one.
    expect(routeKey(routeForPath('get-started.crv'))).toBe(
      routeKey(routeForPath('get-started/index.crv')),
    )
  })
})

describe('rewriteRoute', () => {
  it('publishes an exact source path at another route', () => {
    const rewrites = { 'packages/a/docs/index.crv': '/a/' }

    expect(rewriteRoute('packages/a/docs/index.crv', rewrites)).toBe('/a/')
    expect(rewriteRoute('packages/a/docs/other.crv', rewrites)).toBeUndefined()
  })

  it('moves a directory with a prefix pattern, keeping the tail', () => {
    const rewrites = { 'packages/a/docs/*': '/a/*' }

    expect(rewriteRoute('packages/a/docs/index.crv', rewrites)).toBe('/a/')
    expect(rewriteRoute('packages/a/docs/guide/start.crv', rewrites)).toBe('/a/guide/start')
  })

  it('prefers the longest matching pattern over config order', () => {
    // Config objects have an order, but relying on it would make the result
    // depend on how the file happens to be written.
    const rewrites = { 'packages/*': '/pkg/*', 'packages/a/docs/*': '/a/*' }

    expect(rewriteRoute('packages/a/docs/start.crv', rewrites)).toBe('/a/start')
    expect(rewriteRoute('packages/b/start.crv', rewrites)).toBe('/pkg/b/start')
  })

  it('collapses index files in the rewritten target too', () => {
    expect(rewriteRoute('src/home.crv', { 'src/home.crv': 'index.crv' })).toBe('/')
    expect(rewriteRoute('src/g.crv', { 'src/g.crv': '/guide/index' })).toBe('/guide/')
  })
})
