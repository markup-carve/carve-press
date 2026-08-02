import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'

class FakeOutline {
  scrollTop = 0
  scrolls: Array<{ top: number; behavior: ScrollBehavior }> = []

  constructor(
    private top = 0,
    private bottom = 100,
  ) {}

  getBoundingClientRect(): { top: number; bottom: number } {
    return { top: this.top, bottom: this.bottom }
  }

  scrollTo(opts: { top: number; behavior: ScrollBehavior }): void {
    this.scrollTop = opts.top
    this.scrolls.push(opts)
  }
}

class FakeHeading {
  constructor(
    public id: string,
    public top: number,
  ) {}

  getBoundingClientRect(): { top: number } {
    return { top: this.top }
  }
}

class FakeLink {
  attributes = new Map<string, string>()

  constructor(
    href: string,
    private outline: FakeOutline,
    private top = 0,
    private bottom = 10,
  ) {
    this.attributes.set('href', href)
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name)
  }

  closest(selector: string): FakeOutline | null {
    return selector === '.outline' ? this.outline : null
  }

  getBoundingClientRect(): { top: number; bottom: number } {
    return { top: this.top, bottom: this.bottom }
  }
}

async function importScript({
  links = [],
  headings = [],
  viewportHeight = 1000,
  scrollY = 0,
  scrollHeight = 4000,
  reducedMotion = false,
}: {
  links?: FakeLink[]
  headings?: FakeHeading[]
  viewportHeight?: number
  scrollY?: number
  scrollHeight?: number
  reducedMotion?: boolean
}): Promise<{
  flushFrames: () => void
  scroll: (nextScrollY?: number) => void
  resize: () => void
}> {
  const frames: FrameRequestCallback[] = []
  const listeners = new Map<string, Array<() => void>>()
  const headingById = new Map(headings.map((heading) => [heading.id, heading]))
  const documentElement = { clientHeight: viewportHeight, scrollTop: 0, scrollHeight }
  const body = { scrollTop: 0, scrollHeight }
  const window = {
    innerHeight: viewportHeight,
    scrollY,
    pageYOffset: scrollY,
    matchMedia: vi.fn(() => ({ matches: reducedMotion })),
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    },
    setTimeout,
    addEventListener: (type: string, callback: () => void) => {
      listeners.set(type, [...(listeners.get(type) ?? []), callback])
    },
  }
  const document = {
    querySelectorAll: (selector: string) => (selector === '.outline a[href^="#"]' ? links : []),
    getElementById: (id: string) => headingById.get(id) ?? null,
    documentElement,
    body,
  }

  const script = await readFile(resolve(import.meta.dirname, '../theme/outline.js'), 'utf8')
  runInNewContext(script, { document, window })

  return {
    flushFrames() {
      for (const callback of frames.splice(0)) callback(0)
    },
    scroll(nextScrollY = window.scrollY) {
      window.scrollY = nextScrollY
      window.pageYOffset = nextScrollY
      for (const callback of listeners.get('scroll') ?? []) callback()
    },
    resize() {
      for (const callback of listeners.get('resize') ?? []) callback()
    },
  }
}

function currentLinks(links: FakeLink[]): FakeLink[] {
  return links.filter((link) => link.getAttribute('aria-current') === 'true')
}

afterEach(() => vi.restoreAllMocks())

describe('outline client', () => {
  it('marks the entry for the section above the reading line only', async () => {
    const outline = new FakeOutline()
    const links = [new FakeLink('#intro', outline), new FakeLink('#usage', outline), new FakeLink('#api', outline)]
    await importScript({
      links,
      headings: [
        new FakeHeading('intro', -500),
        new FakeHeading('usage', 200),
        new FakeHeading('api', 500),
      ],
    })

    expect(currentLinks(links)).toEqual([links[1]!])
  })

  it('marks the first entry before the first heading passes the reading line', async () => {
    const outline = new FakeOutline()
    const links = [new FakeLink('#intro', outline), new FakeLink('#usage', outline)]
    await importScript({
      links,
      headings: [new FakeHeading('intro', 300), new FakeHeading('usage', 700)],
    })

    expect(currentLinks(links)).toEqual([links[0]!])
  })

  it('marks the last entry at the bottom of the page even when the final section is short', async () => {
    const outline = new FakeOutline()
    const links = [new FakeLink('#intro', outline), new FakeLink('#usage', outline), new FakeLink('#end', outline)]
    await importScript({
      links,
      headings: [
        new FakeHeading('intro', -900),
        new FakeHeading('usage', 100),
        new FakeHeading('end', 900),
      ],
      viewportHeight: 1000,
      scrollY: 3000,
      scrollHeight: 4000,
    })

    expect(currentLinks(links)).toEqual([links[2]!])
  })

  it('moves the mark between sections and clears the previous entry', async () => {
    const outline = new FakeOutline()
    const links = [new FakeLink('#intro', outline), new FakeLink('#usage', outline)]
    const headings = [new FakeHeading('intro', 100), new FakeHeading('usage', 600)]
    const { scroll, flushFrames } = await importScript({ links, headings })

    expect(currentLinks(links)).toEqual([links[0]!])

    headings[1]!.top = 100
    scroll(500)
    flushFrames()

    expect(currentLinks(links)).toEqual([links[1]!])
    expect(links[0]!.getAttribute('aria-current')).toBeNull()
  })

  it('does not throw on a page with no outline', async () => {
    await expect(importScript({ links: [], headings: [] })).resolves.toBeDefined()
  })

  it('keeps an out-of-view active entry visible inside the outline', async () => {
    const outline = new FakeOutline(0, 100)
    const links = [new FakeLink('#intro', outline, 0, 10), new FakeLink('#usage', outline, 130, 150)]
    await importScript({
      links,
      headings: [new FakeHeading('intro', -500), new FakeHeading('usage', 100)],
      reducedMotion: true,
    })

    expect(outline.scrolls).toEqual([{ top: 50, behavior: 'auto' }])
  })
})
