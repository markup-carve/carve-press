import { describe, expect, it, vi } from 'vitest'
import type { Page } from '../src/content/discover.js'

// Published 0.1.15 emits neither kind of finding, so the engine is stubbed.
vi.mock('@markup-carve/carve', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@markup-carve/carve')>()
  return {
    ...actual,
    lintCarve: (source: string) => {
      if (source.includes('hint')) {
        return [{ line: 3, column: 1, rule: 'thematic-break-spelling', severity: 'Hint', message: 'Write ***.' }]
      }
      if (source.includes('deprecated')) {
        return [{ line: 1, column: 3, rule: 'deprecated-cell-alignment', message: 'Write ={<}.' }]
      }
      return [{ line: 2, column: 1, rule: 'broken-crossref', severity: 'warning', message: 'No target.' }]
    },
  }
})

const { validateCrossrefs } = await import('../src/validate.js')
const src = (source: string) => ({ relPath: 'a.crv', source, bodyStartLine: 1 }) as unknown as Page

describe('validateCrossrefs lint severity', () => {
  it('does not fail on a lint hint', () => {
    expect(() => validateCrossrefs([src('hint')])).not.toThrow()
  })

  it('prints a deprecated spelling without failing the build', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(() => validateCrossrefs([src('deprecated')])).not.toThrow()
      expect(warn).toHaveBeenCalledWith('carve-press: a.crv:1:3 deprecated-cell-alignment - Write ={<}.')
    } finally {
      warn.mockRestore()
    }
  })

  it('still fails on a warning that carries a severity', () => {
    expect(() => validateCrossrefs([src('other')])).toThrow(/a\.crv:2:1 broken-crossref/)
  })
})
