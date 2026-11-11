import { describe, expect, it } from 'vitest'
// @ts-expect-error plain .mjs tool without type declarations
import { declaredInputs, declaredPairs } from '../tools/example-pair-census.mjs'

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

describe('declaredInputs', () => {
  it('keys each pair by its input bytes, so duplicate inputs collapse', () => {
    const page = [
      '::: compare',
      '```carve',
      'same',
      '```',
      '```html',
      '<p>same</p>',
      '```',
      ':::',
      '::: compare no-render',
      '```carve',
      'same',
      '```',
      '```html',
      '<p>same</p>',
      '```',
      ':::',
      '::: compare crlf',
      '```carve',
      'same',
      '```',
      '```html',
      '<p>same</p>',
      '```',
      ':::',
      '::: compare',
      '````carve',
      '```carve',
      'nested',
      '```',
      '````',
      '```html',
      '<pre></pre>',
      '```',
      ':::',
    ].join('\n')
    expect(declaredPairs(page)).toBe(4)
    expect(new Set(declaredInputs(page)).size).toBe(3)
  })
})
