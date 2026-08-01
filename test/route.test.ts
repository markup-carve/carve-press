import { describe, it, expect } from 'vitest'
import { routeForPath, outPathForRoute } from '../src/content/route.js'

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

  it('accepts the .carve extension too', () => {
    expect(routeForPath('page.carve')).toBe('/page')
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
