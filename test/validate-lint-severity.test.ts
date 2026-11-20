import { describe, expect, it, vi } from 'vitest'
import type { Page } from '../src/content/discover.js'

// The engine is stubbed so each severity is exercised in isolation.
vi.mock('@markup-carve/carve', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@markup-carve/carve')>()
  const at = (startOffset: number) => ({ startOffset, endOffset: startOffset + 1 })
  return {
    ...actual,
    lint: (source: string) => {
      if (source.includes('hint')) {
        return [{ code: 'thematic-break-spelling', severity: 'hint', channel: 'lint', message: 'Write ***.', range: at(0) }]
      }
      if (source.includes('deprecated')) {
        return [{ code: 'deprecated-cell-alignment', severity: 'warning', channel: 'lint', message: 'Write ={<}.', range: at(2) }]
      }
      return [{ code: 'broken-crossref', severity: 'warning', channel: 'lint', message: 'No target.', range: at(6) }]
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
    expect(() => validateCrossrefs([src('other\nx')])).toThrow(/a\.crv:2:1 broken-crossref/)
  })
})
