import { describe, expect, it } from 'vitest'
// @ts-expect-error plain .mjs tool without type declarations
import { declaredPairs } from '../tools/example-pair-census.mjs'

describe('declaredPairs', () => {
  it('counts every carve fence in a compare block, not one per block', () => {
    const page = [
      '::: compare',
      '```carve',
      'one',
      '```',
      '```html',
      '<p>one</p>',
      '```',
      '````carve',
      '```carve',
      'nested, not a pair',
      '```',
      '````',
      '```html',
      '<p>two</p>',
      '```',
      '```carve',
      'three',
      '```',
      '```html',
      '<p>three</p>',
      '```',
      ':::',
      '```carve',
      'outside any block',
      '```',
    ].join('\n')
    expect(declaredPairs(page)).toBe(3)
  })
})
