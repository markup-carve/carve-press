import { describe, it, expect, vi } from 'vitest'
import { carveToHtml } from '@markup-carve/carve'
import { resolveConfig } from '../src/config.js'
import { buildExtensionStack } from '../src/render/extensions.js'

const shiki = { langs: ['js'], themes: { light: 'github-light', dark: 'github-dark' } }

async function stack(substitutions: object | undefined) {
  const config = resolveConfig({
    title: 'T',
    carve: { preset: 'minimal' },
    ...(substitutions === undefined ? {} : { substitutions }),
  })
  return buildExtensionStack(config, shiki)
}

describe('substitutions', () => {
  it('replaces a token in prose and honors the configured format', async () => {
    const extensions = await stack({
      phpversion: { value: '8.5', format: 'bold' },
      minphp: '8.2',
      pkg: { value: 'carve-press', format: 'code' },
    })

    const html = carveToHtml('Needs |phpversion|, at least |minphp|, from |pkg|.\n', { extensions })

    expect(html).toContain('<strong>8.5</strong>')
    expect(html).toContain('at least 8.2')
    expect(html).toContain('<code>carve-press</code>')
    expect(html).not.toContain('|phpversion|')
  })

  it('leaves tokens inside code alone', async () => {
    const extensions = await stack({ phpversion: '8.5' })

    const fence = carveToHtml('```txt\nUse |phpversion| here.\n```\n', { extensions })
    const inline = carveToHtml('Write `|phpversion|` to show the token.\n', { extensions })

    // Scoped to the code itself: the copy icon's path data contains "8.5".
    const code = /<pre[\s\S]*?<\/pre>/.exec(fence)?.[0] ?? ''
    // A page documenting substitutions has to be able to print the token.
    expect(code).toContain('|phpversion|')
    expect(code).not.toContain('8.5')
    expect(inline).toContain('<code>|phpversion|</code>')
  })

  it('leaves an unknown token in place and warns once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const extensions = await stack({ known: '1' })

    const html = carveToHtml('First |missing|, then |missing| again.\n', { extensions })

    expect(html).toContain('|missing|')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]?.[0]).toContain('missing')
    warn.mockRestore()
  })

  it('adds nothing to the render stack when no substitutions are configured', async () => {
    const without = await stack(undefined)
    const withEmpty = await stack({})
    const withSome = await stack({ phpversion: '8.5' })

    expect(without.map((extension) => extension.name)).not.toContain('carve-press-substitutions')
    expect(withEmpty.map((extension) => extension.name)).not.toContain('carve-press-substitutions')
    expect(withSome.map((extension) => extension.name)).toContain('carve-press-substitutions')

    // Output is untouched for a site that does not use the feature, tokens included.
    const source = 'A |phpversion| token and *bold*.\n'
    expect(carveToHtml(source, { extensions: without })).toBe(carveToHtml(source, { extensions: withEmpty }))
    expect(carveToHtml(source, { extensions: without })).toContain('|phpversion|')
  })

  it('reaches tokens in headings, lists, and admonitions', async () => {
    const extensions = await stack({ v: '9' })
    const source = [
      '## Version |v|',
      '',
      '- item |v|',
      '',
      '::: note "Title |v|"',
      'body |v|',
      ':::',
      '',
    ].join('\n')

    const html = carveToHtml(source, { extensions })

    expect(html).not.toContain('|v|')
    expect(html).toContain('Version 9')
    expect(html).toContain('item 9')
    expect(html).toContain('Title 9')
    expect(html).toContain('body 9')
  })

  it('does not reach into a table row, where pipes are cell delimiters', async () => {
    const extensions = await stack({ v: '9' })

    const html = carveToHtml('|= Head |v| |\n| cell |v| |\n', { extensions })

    // The parser splits on the pipes long before substitution runs, so the
    // token is two cell boundaries around a "v". Documented, not fixable here.
    expect(html).toContain('<td>v</td>')
    expect(html).not.toContain('<td>9</td>')
  })
})
