import { describe, it, expect } from 'vitest'
import { resolveConfig } from '../src/config.js'
import { buildExtensionStack } from '../src/render/extensions.js'

const shiki = { langs: ['js'], themes: { light: 'github-light', dark: 'github-dark' } }

describe('buildExtensionStack', () => {
  it('includes the built-in extensions in a stable order', async () => {
    const stack = await buildExtensionStack(resolveConfig({ title: 'x' }), shiki)
    const names = stack.map((e) => e.name)
    expect(names.slice(0, 5)).toEqual([
      'shiki',
      'carve-press-compare',
      'carve-press-playground',
      'code-group',
      'heading-permalinks',
    ])
  })

  it('appends user extensions last so they can override built-ins', async () => {
    const mine = { name: 'mine' }
    const stack = await buildExtensionStack(
      resolveConfig({ title: 'x', carve: { extensions: [mine] } }),
      shiki,
    )
    expect(stack.at(-1)?.name).toBe('mine')
  })
})
