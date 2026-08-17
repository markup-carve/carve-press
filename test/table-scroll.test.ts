import { describe, expect, it } from 'vitest'
import { carveToHtml } from '@markup-carve/carve'
import { tableScrollExtension } from '../src/render/table-scroll.js'

const render = (source: string) => carveToHtml(source, { extensions: [tableScrollExtension()] })

describe('tableScrollExtension', () => {
  it('wraps a table in a keyboard-focusable scroll region', () => {
    const html = render('| a | b |\n')
    expect(html).toContain('<div class="table-scroll" tabindex="0">')
    expect(html).toContain('<table>')
  })

  it('names only captioned tables as regions', () => {
    const captioned = render('| a | b |\n^ Cap & < >\n')
    expect(captioned).toContain(
      '<div class="table-scroll" tabindex="0" role="region" aria-label="Cap &amp; &lt; &gt;">',
    )

    const uncaptioned = render('| a | b |\n')
    expect(uncaptioned).not.toContain('role="region"')
    expect(uncaptioned).not.toContain('aria-label=')
    expect(uncaptioned).not.toContain('aria-labelledby=')
  })

  it('uses a caption id as the region name when one is authored', () => {
    const html = render('| a | b |\n^ [Cap]{#cap-id}\n')
    expect(html).toContain(
      '<div class="table-scroll" tabindex="0" role="region" aria-labelledby="cap-id">',
    )
    expect(html).toContain('<caption><span id="cap-id">Cap</span></caption>')
  })

  it('delegates table rendering to the core renderer', () => {
    const html = render('|=> H | B | < |\n| a | b | c |\n')
    // The engine scopes header cells: a header cell in a body row is a row
    // header, and the scope rides ahead of the author's own attributes.
    expect(html).toContain('<th scope="row" style="text-align: right;">H</th>')
    expect(html).toContain('<td colspan="2">B</td>')
    expect(html).toContain('<td>a</td><td>b</td><td>c</td>')
  })

  it('keeps authored table attributes on the table', () => {
    const html = render('{#prices .wide data-x="1&2"}\n| a | b |\n')
    expect(html).toContain('<div class="table-scroll" tabindex="0">')
    expect(html).toContain('<table id="prices" class="wide" data-x="1&amp;2">')
  })
})
