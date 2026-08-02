import { describe, expect, it } from 'vitest'
import { carveToHtml } from '@markup-carve/carve'
import { playgroundExtension } from '../src/render/playground.js'

const render = (src: string) => carveToHtml(src, { extensions: [playgroundExtension()] })

describe('playgroundExtension', () => {
  it('renders a playground element with the initial source and rendered output', () => {
    const html = render(['::: playground', '```carve', '*bold*', '```', ':::'].join('\n'))
    expect(html).toContain('<carve-playground class="carve-playground">')
    expect(html).toContain('data-carve-playground-source')
    expect(html).toContain('*bold*')
    expect(html).toContain('<strong>bold</strong>')
  })

  it('falls back to the built-in sample when no carve fence is present', () => {
    const html = render('::: playground\n:::')
    expect(html).toContain('/italic/')
    expect(html).toContain('<em>italic</em>')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<u>underline</u>')
    expect(html).toContain('<s>strike</s>')
    expect(html).toContain('<mark>highlight</mark>')
  })

  it('leaves an admonition that is not a playground block alone', () => {
    const html = render('::: note\nbody\n:::')
    expect(html).not.toContain('carve-playground')
    expect(html).toContain('admonition')
  })

  it('escapes source and HTML-source fallback text without escaping the rendered pane', () => {
    const html = render(['::: playground', '```carve', '<script>alert(1)</script>', '```', ':::'].join('\n'))
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;')
  })
})
