import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'

class FakeStyle {
  values = new Map<string, string>()

  setProperty(name: string, value: string): void {
    this.values.set(name, value)
  }

  removeProperty(name: string): void {
    this.values.delete(name)
  }
}

class FakeBlock {
  attributes = new Set<string>()
  style = new FakeStyle()

  constructor(
    public scrollWidth: number,
    public clientWidth: number,
    private height = 40,
  ) {}

  toggleAttribute(name: string, force?: boolean): boolean {
    const next = force ?? !this.attributes.has(name)
    if (next) this.attributes.add(name)
    else this.attributes.delete(name)
    return next
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name)
  }

  getBoundingClientRect(): { height: number } {
    return { height: this.height }
  }
}

async function importScript(blocks: FakeBlock[]): Promise<{ flushFrames: () => void; resize: () => void }> {
  const frames: FrameRequestCallback[] = []
  let resizeCallback: (() => void) | undefined

  class FakeResizeObserver {
    constructor(callback: () => void) {
      resizeCallback = callback
    }

    observe(): void {}
  }

  const document = {
    fonts: { ready: Promise.resolve() },
    querySelectorAll: () => blocks,
  }
  const window = {
    ResizeObserver: FakeResizeObserver,
    addEventListener: vi.fn(),
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    },
    setTimeout,
  }

  const script = await readFile(resolve(import.meta.dirname, '../theme/table-scroll.js'), 'utf8')
  runInNewContext(script, { document, window })

  return {
    flushFrames() {
      for (const callback of frames.splice(0)) callback(0)
    },
    resize() {
      resizeCallback?.()
    },
  }
}

afterEach(() => vi.restoreAllMocks())

describe('table-scroll client', () => {
  it('marks genuinely overflowing blocks only', async () => {
    const overflowing = new FakeBlock(203, 200)
    const fitting = new FakeBlock(202, 200)
    const { flushFrames } = await importScript([overflowing, fitting])

    flushFrames()

    expect(overflowing.hasAttribute('data-overflowing')).toBe(true)
    expect(overflowing.style.values.get('--wide-block-height')).toBe('40px')
    expect(fitting.hasAttribute('data-overflowing')).toBe(false)
    expect(fitting.style.values.has('--wide-block-height')).toBe(false)
  })

  it('removes the marker when a block stops overflowing', async () => {
    const block = new FakeBlock(220, 200)
    const { flushFrames, resize } = await importScript([block])

    flushFrames()
    expect(block.hasAttribute('data-overflowing')).toBe(true)

    block.scrollWidth = 200
    resize()
    flushFrames()

    expect(block.hasAttribute('data-overflowing')).toBe(false)
    expect(block.style.values.has('--wide-block-height')).toBe(false)
  })

  it('scopes hover expansion CSS to overflowing blocks', async () => {
    const css = await readFile(resolve(import.meta.dirname, '../theme/default.css'), 'utf8')
    const expandingRules = [...css.matchAll(/([^{}]+)\{([^{}]+)\}/g)].filter(([, selector, body]) => {
      return (
        selector !== undefined &&
        body !== undefined &&
        /(?:\.table-scroll|\.carve-compare).*:(?:is\()?/.test(selector) &&
        /(?:hover|focus-within)/.test(selector) &&
        /(?:overflow:\s*visible|position:\s*absolute)/.test(body)
      )
    })

    expect(expandingRules.length).toBeGreaterThan(0)
    for (const [rule, selector] of expandingRules) {
      expect(selector, rule).toContain('[data-overflowing]')
    }
  })
})
