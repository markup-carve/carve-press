import { describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'

class FakeElement {
  hidden = false
  inert = false
  parent?: FakeElement
  children: FakeElement[] = []
  listeners = new Map<string, Array<(event: FakeEvent) => void>>()
  attributes = new Map<string, string>()

  constructor(
    public tagName: string,
    attrs: Record<string, string> = {},
    public document?: FakeDocument,
  ) {
    for (const [key, value] of Object.entries(attrs)) this.attributes.set(key, value)
  }

  append(child: FakeElement): void {
    child.parent = this
    child.document = this.document
    this.children.push(child)
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

  addEventListener(type: string, callback: (event: FakeEvent) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), callback])
  }

  click(target: FakeElement = this): void {
    for (const callback of this.listeners.get('click') ?? []) callback(new FakeEvent('click', target))
  }

  focus(): void {
    if (this.document !== undefined) this.document.activeElement = this
  }

  closest(selector: string): FakeElement | null {
    if (matches(this, selector)) return this
    return this.parent?.closest(selector) ?? null
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null
  }

  querySelectorAll(selector: string): FakeElement[] {
    return descendants(this).filter((element) => matches(element, selector))
  }
}

class FakeEvent {
  defaultPrevented = false
  shiftKey = false

  constructor(
    public key: string,
    public target: FakeElement,
  ) {}

  preventDefault(): void {
    this.defaultPrevented = true
  }
}

class FakeDocument {
  activeElement?: FakeElement
  documentElement = new FakeElement('html', {}, this)
  listeners = new Map<string, Array<(event: FakeEvent) => void>>()

  constructor(public elements: FakeElement[]) {
    for (const element of elements) assignDocument(element, this)
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null
  }

  querySelectorAll(selector: string): FakeElement[] {
    return this.elements.filter((element) => matches(element, selector))
  }

  getElementById(id: string): FakeElement | null {
    return this.elements.find((element) => element.getAttribute('id') === id) ?? null
  }

  addEventListener(type: string, callback: (event: FakeEvent) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), callback])
  }

  keydown(key: string, shiftKey = false): FakeEvent {
    const event = new FakeEvent(key, this.activeElement ?? this.documentElement)
    event.shiftKey = shiftKey
    for (const callback of this.listeners.get('keydown') ?? []) callback(event)
    return event
  }
}

function descendants(root: FakeElement): FakeElement[] {
  return root.children.flatMap((child) => [child, ...descendants(child)])
}

function assignDocument(element: FakeElement, document: FakeDocument): void {
  element.document = document
  for (const child of element.children) assignDocument(child, document)
}

function matches(element: FakeElement, selector: string): boolean {
  if (selector === '[data-drawer-toggle]') return element.getAttribute('data-drawer-toggle') !== null
  if (selector === '[data-drawer-scrim]') return element.getAttribute('data-drawer-scrim') !== null
  if (selector.includes('a[href]') && element.tagName === 'a' && element.getAttribute('href') !== null) return true
  if (selector.includes('button:not([disabled])')) return element.tagName === 'button'
  return false
}

async function importScript(mobileMatches = true): Promise<{
  document: FakeDocument
  toggle: FakeElement
  drawer: FakeElement
  link: FakeElement
  scrim: FakeElement
  media: { matches: boolean; change: () => void }
}> {
  const toggle = new FakeElement('button', {
    'data-drawer-toggle': 'nav',
    'aria-controls': 'site-nav-drawer',
    'aria-expanded': 'false',
  })
  const link = new FakeElement('a', { href: '/start' })
  const drawer = new FakeElement('nav', { id: 'site-nav-drawer' })
  drawer.append(link)
  const scrim = new FakeElement('div', { 'data-drawer-scrim': '' })
  const document = new FakeDocument([toggle, drawer, scrim])
  const mediaListeners: Array<() => void> = []
  const media = {
    matches: mobileMatches,
    addEventListener: (_type: string, callback: () => void) => mediaListeners.push(callback),
    change: () => {
      for (const callback of mediaListeners) callback()
    },
  }
  const script = await readFile(resolve(import.meta.dirname, '../theme/nav.js'), 'utf8')
  runInNewContext(script, {
    document,
    window: { matchMedia: vi.fn(() => media) },
    HTMLElement: FakeElement,
    Element: FakeElement,
  })
  return { document, toggle, drawer, link, scrim, media }
}

describe('mobile nav client', () => {
  it('hides mobile drawers from focus order until opened', async () => {
    const { drawer } = await importScript()
    expect(drawer.hidden).toBe(true)
    expect(drawer.inert).toBe(true)
  })

  it('opens from the toggle, closes on Escape, and restores focus', async () => {
    const { document, toggle, drawer, link, scrim } = await importScript()
    toggle.click()
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(drawer.hidden).toBe(false)
    expect(drawer.inert).toBe(false)
    expect(scrim.hidden).toBe(false)
    expect(document.activeElement).toBe(link)

    document.keydown('Escape')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(drawer.hidden).toBe(true)
    expect(drawer.inert).toBe(true)
    expect(scrim.hidden).toBe(true)
    expect(document.activeElement).toBe(toggle)
  })

  it('closes on navigation without restoring focus to the toggle', async () => {
    const { document, toggle, drawer, link } = await importScript()
    toggle.click()
    link.focus()
    drawer.click(link)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(drawer.hidden).toBe(true)
    expect(document.activeElement).toBe(link)
  })

  it('traps Tab focus inside an open drawer', async () => {
    const { document, toggle, link } = await importScript()
    toggle.click()
    document.activeElement = link
    const event = document.keydown('Tab')
    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(link)
  })
})
