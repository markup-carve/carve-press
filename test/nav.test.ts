import { describe, it, expect } from 'vitest'
import { resolveSidebar, flattenSidebar, resolvePrevNext } from '../src/nav.js'
import type { SidebarGroup } from '../src/config.js'

const root: SidebarGroup[] = [
  { text: 'Intro', items: [{ text: 'Start', link: '/start' }, { text: 'Guide', link: '/guide/' }] },
]
const caseStudy: SidebarGroup[] = [
  {
    text: 'Case Study',
    items: [
      { text: 'Overview', link: '/case-study/' },
      { text: 'Background', link: '/case-study/background' },
    ],
  },
]
const sidebar = { '/': root, '/case-study/': caseStudy }

describe('resolveSidebar', () => {
  it('picks the longest matching key prefix', () => {
    expect(resolveSidebar('/case-study/background', sidebar)).toBe(caseStudy)
    expect(resolveSidebar('/start', sidebar)).toBe(root)
  })

  it('returns an empty sidebar when nothing matches', () => {
    expect(resolveSidebar('/x', { '/docs/': root })).toEqual([])
  })
})

describe('flattenSidebar', () => {
  it('flattens depth-first and drops group headings without links', () => {
    const nested: SidebarGroup[] = [
      {
        text: 'G',
        items: [
          { text: 'A', link: '/a' },
          { text: 'B', link: '/b', items: [{ text: 'B1', link: '/b1' }] },
          { text: 'NoLink' },
        ],
      },
    ]
    expect(flattenSidebar(nested).map((i) => i.link)).toEqual(['/a', '/b', '/b1'])
  })
})

describe('resolvePrevNext', () => {
  it('returns the neighbors of the current route', () => {
    const r = resolvePrevNext('/case-study/background', caseStudy)
    expect(r.prev?.link).toBe('/case-study/')
    expect(r.next).toBeUndefined()
  })

  it('has no prev on the first entry', () => {
    expect(resolvePrevNext('/case-study/', caseStudy).prev).toBeUndefined()
  })

  it('returns nothing for a route absent from the sidebar', () => {
    expect(resolvePrevNext('/nowhere', caseStudy)).toEqual({})
  })
})
