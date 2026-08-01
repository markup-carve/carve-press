import { describe, expect, it, vi } from 'vitest'
import { validateCrossrefs, validateLinks, validateNav } from '../src/validate.js'
import type { Page } from '../src/content/discover.js'
import type { RenderedPage } from '../src/render/page.js'

const page = (relPath: string, html: string): RenderedPage =>
  ({ page: { relPath, route: '/x' }, html, outline: [], searchDoc: {} }) as unknown as RenderedPage

describe('validateLinks', () => {
  const routes = new Set(['/', '/start', '/guide/'])

  it('accepts links that resolve to a known route', () => {
    expect(() =>
      validateLinks([page('a.crv', '<a href="/start">s</a><a href="/guide/">g</a>')], routes, false),
    ).not.toThrow()
  })

  it('rejects a link to an unknown route and names the file', () => {
    expect(() => validateLinks([page('a.crv', '<a href="/nope">n</a>')], routes, false)).toThrow(
      /a\.crv.*\/nope/s,
    )
  })

  it('lists every dead link in one error', () => {
    try {
      validateLinks([page('a.crv', '<a href="/x1">1</a><a href="/x2">2</a>')], routes, false)
      expect.unreachable('should have thrown')
    } catch (error) {
      expect((error as Error).message + String((error as { details?: string[] }).details)).toContain(
        '/x1',
      )
      expect(String((error as { details?: string[] }).details)).toContain('/x2')
    }
  })

  it('ignores external, anchor, and mailto links', () => {
    const html =
      '<a href="https://x.com">e</a><a href="#frag">f</a><a href="mailto:a@b.c">m</a><a href="/start#f">s</a>'
    expect(() => validateLinks([page('a.crv', html)], routes, false)).not.toThrow()
  })

  it('is a no-op when ignoreDeadLinks is on', () => {
    expect(() => validateLinks([page('a.crv', '<a href="/nope">n</a>')], routes, true)).not.toThrow()
  })

  it('strips query strings before comparing links to routes', () => {
    expect(() => validateLinks([page('a.crv', '<a href="/start?from=a">s</a>')], routes, false)).not.toThrow()
  })

  it('ignores protocol-relative links', () => {
    expect(() => validateLinks([page('a.crv', '<a href="//example.com/x">x</a>')], routes, false)).not.toThrow()
  })
})

describe('validateNav', () => {
  const routes = new Set(['/', '/start'])
  const theme = (over: object) =>
    ({ nav: [], sidebar: {}, socialLinks: [], outline: { level: [2, 3] }, ...over }) as never

  it('accepts nav and sidebar entries pointing at real routes', () => {
    expect(() =>
      validateNav(
        theme({
          nav: [{ text: 'S', link: '/start' }],
          sidebar: { '/': [{ text: 'G', items: [{ text: 'S', link: '/start' }] }] },
        }),
        routes,
      ),
    ).not.toThrow()
  })

  it('rejects a nav entry pointing nowhere', () => {
    expect(() => validateNav(theme({ nav: [{ text: 'X', link: '/gone' }] }), routes)).toThrow(
      /nav.*\/gone/s,
    )
  })

  it('rejects a sidebar entry pointing nowhere', () => {
    expect(() =>
      validateNav(
        theme({ sidebar: { '/': [{ text: 'G', items: [{ text: 'X', link: '/gone' }] }] } }),
        routes,
      ),
    ).toThrow(/sidebar.*\/gone/s)
  })

  it('checks nested nav dropdown items', () => {
    expect(() =>
      validateNav(theme({ nav: [{ text: 'G', items: [{ text: 'X', link: '/gone' }] }] }), routes),
    ).toThrow(/\/gone/)
  })

  it('rejects a duplicate sidebar link in the same sidebar', () => {
    expect(() =>
      validateNav(
        theme({
          sidebar: {
            '/': [
              {
                text: 'G',
                items: [
                  { text: 'S1', link: '/start' },
                  { text: 'S2', link: '/start' },
                ],
              },
            ],
          },
        }),
        routes,
      ),
    ).toThrow(/duplicate.*\/start/s)
  })

  it('warns, but does not fail, when a sidebar key does not end in slash', () => {
    // A non-slash key is legal and may be deliberate, so it must not block a
    // build - unlike a dead entry or a duplicate link, which cannot be right.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() =>
      validateNav(
        theme({ sidebar: { '/case': [{ text: 'G', items: [{ text: 'S', link: '/start' }] }] } }),
        routes,
      ),
    ).not.toThrow()
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/\/case.*end in \//))
    warn.mockRestore()
  })
})

describe('validateCrossrefs', () => {
  const src = (source: string) =>
    ({ relPath: 'a.crv', source, bodyStartLine: 1 }) as unknown as Page

  it('accepts a crossref that resolves to a heading', () => {
    expect(() => validateCrossrefs([src('# Install\n\nSee </#Install>.\n')])).not.toThrow()
  })

  it('rejects a crossref with no matching heading', () => {
    // lintCarve reports this as broken-crossref: the reference renders as
    // literal text, which is exactly the silent degradation to fail on.
    expect(() => validateCrossrefs([src('# Install\n\nSee </#missing>.\n')])).toThrow(
      /broken-crossref/,
    )
  })

  it('reports the location in the original file, not the body', () => {
    const page = {
      relPath: 'a.crv',
      source: '\nSee </#missing>.\n',
      bodyStartLine: 4,
    } as unknown as Page
    // Body line 2 with a bodyStartLine of 4 is original line 5.
    expect(() => validateCrossrefs([page])).toThrow(/a\.crv:5:/)
  })
})
