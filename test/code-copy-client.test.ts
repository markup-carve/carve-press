import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

class FakeButton {
  textContent = ''
  dataset: Record<string, string> = {}
  removed = false
  attributes: Record<string, string> = { 'aria-label': 'Copy code' }
  private listeners = new Map<string, () => void>()

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value
  }

  addEventListener(name: string, listener: () => void): void {
    this.listeners.set(name, listener)
  }

  click(): void {
    this.listeners.get('click')?.()
  }

  remove(): void {
    this.removed = true
  }
}

class FakeTemplate {
  content = { textContent: 'raw <code> & text' }
  textContent = ''
}

class FakeBlock {
  constructor(
    private readonly button: FakeButton,
    private readonly template: FakeTemplate,
    private readonly skip = false,
  ) {}

  querySelector(selector: string): FakeButton | FakeTemplate | null {
    if (selector === '.code-block__copy') return this.button
    if (selector === 'template[data-code-block-copy]') return this.template
    return null
  }

  closest(selector: string): FakeBlock | null {
    if (selector === '.carve-playground' && this.skip) return this
    return null
  }
}

const realGlobals = {
  document: globalThis.document,
  HTMLButtonElement: globalThis.HTMLButtonElement,
  HTMLTemplateElement: globalThis.HTMLTemplateElement,
  navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'),
  window: globalThis.window,
}

afterEach(() => {
  vi.restoreAllMocks()
  Object.assign(globalThis, {
    document: realGlobals.document,
    HTMLButtonElement: realGlobals.HTMLButtonElement,
    HTMLTemplateElement: realGlobals.HTMLTemplateElement,
    window: realGlobals.window,
  })
  if (realGlobals.navigator) Object.defineProperty(globalThis, 'navigator', realGlobals.navigator)
})

describe('code copy client', () => {
  it('copies raw template text and restores the button label', async () => {
    const button = new FakeButton()
    const template = new FakeTemplate()
    const block = new FakeBlock(button, template)
    const copied: string[] = []
    const timeouts: Array<() => void> = []

    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { clipboard: { writeText: vi.fn((text: string) => copied.push(text)) } },
    })
    Object.assign(globalThis, {
      HTMLButtonElement: FakeButton,
      HTMLTemplateElement: FakeTemplate,
      document: { querySelectorAll: () => [block] },
      window: {
        clearTimeout: vi.fn(),
        setTimeout: vi.fn((callback: () => void) => {
          timeouts.push(callback)
          return 1
        }),
      },
    })

    await import(`${pathToFileURL(resolve(import.meta.dirname, '../theme/code-copy.js')).href}?copy=${Date.now()}`)
    button.click()
    await Promise.resolve()
    await Promise.resolve()

    expect(copied).toEqual(['raw <code> & text'])
    // The visible state is an icon swap driven by the data attribute; the
    // accessible name is what actually announces the change.
    expect(button.getAttribute('aria-label')).toBe('Copied')
    expect(button.dataset.copied).toBe('true')

    timeouts[0]?.()
    expect(button.getAttribute('aria-label')).toBe('Copy code')
    expect(button.dataset.copied).toBeUndefined()
  })

  it('removes duplicate buttons inside playground blocks', async () => {
    const button = new FakeButton()
    const block = new FakeBlock(button, new FakeTemplate(), true)

    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} })
    Object.assign(globalThis, {
      HTMLButtonElement: FakeButton,
      HTMLTemplateElement: FakeTemplate,
      document: { querySelectorAll: () => [block] },
      window: { clearTimeout, setTimeout },
    })

    await import(`${pathToFileURL(resolve(import.meta.dirname, '../theme/code-copy.js')).href}?skip=${Date.now()}`)
    expect(button.removed).toBe(true)
  })
})
