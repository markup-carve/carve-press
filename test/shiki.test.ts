import { describe, it, expect, vi } from 'vitest'
import { carveToHtml } from '@markup-carve/carve'
import { createShikiExtension } from '../src/render/shiki.js'

const ext = await createShikiExtension({
  langs: ['js'],
  themes: { light: 'github-light', dark: 'github-dark' },
})

describe('createShikiExtension', () => {
  it('highlights a fence in a registered language', () => {
    const html = carveToHtml('```js\nconst x = 1\n```\n', { extensions: [ext] })
    expect(html).toContain('shiki')
    expect(html).toContain('const')
    expect(html).toContain('<span')
  })

  it('emits both theme variants as CSS variables', () => {
    const html = carveToHtml('```js\nconst x = 1\n```\n', { extensions: [ext] })
    expect(html).toContain('--shiki-dark')
  })

  it('renders an unregistered language plain and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const html = carveToHtml('```brainfuck\n+++\n```\n', { extensions: [ext] })
    expect(html).toContain('+++')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('brainfuck'))
    warn.mockRestore()
  })

  it('renders a fence with no language plain', () => {
    const html = carveToHtml('```\nplain\n```\n', { extensions: [ext] })
    expect(html).toContain('plain')
  })

  it('escapes HTML in an unhighlighted block', () => {
    const html = carveToHtml('```\n<script>x</script>\n```\n', { extensions: [ext] })
    expect(html).not.toContain('<script>x')
    expect(html).toContain('&lt;script&gt;')
  })
})
