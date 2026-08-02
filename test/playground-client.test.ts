import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { carveToHtml } from '@markup-carve/carve'
import { afterEach, describe, expect, it } from 'vitest'
import { playgroundExtension } from '../src/render/playground.js'

const execFileAsync = promisify(execFile)
const chromeFlags = [
  '--headless=new',
  '--no-sandbox',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--allow-file-access-from-files',
]

const chromeCandidates = [
  process.env.CHROME_BIN,
  '/bin/google-chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter((candidate): candidate is string => Boolean(candidate))

function chromeBin(): string | undefined {
  return chromeCandidates.find((candidate) => existsSync(candidate))
}

async function canDriveChrome(bin: string): Promise<boolean> {
  try {
    await execFileAsync(bin, [...chromeFlags, '--dump-dom', 'about:blank'], { timeout: 5000 })
    return true
  } catch {
    return false
  }
}

function fixtureHtml(playgroundMarkup: string): string {
  return `<!doctype html>
<html>
  <body>
    ${playgroundMarkup}
    <script type="module">
      const delay = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms))
      const assert = (condition, message) => {
        if (!condition) throw new Error(message)
      }
      const finish = (result) => {
        const node = document.createElement('pre')
        node.id = 'result'
        node.textContent = JSON.stringify(result)
        document.body.append(node)
      }

      try {
        const waitFor = async (predicate, what) => {
          // Poll rather than sleeping a fixed amount: the debounce plus a real
          // render takes longer on a loaded machine, and a fixed delay turns
          // that into a flaky failure rather than a real one.
          for (let i = 0; i < 100; i++) {
            if (predicate()) return
            await delay(50)
          }
          throw new Error('timed out waiting for: ' + what)
        }

        await import('./assets/playground.js')
        await customElements.whenDefined('carve-playground')
        const el = document.querySelector('carve-playground')
        const textarea = el.querySelector('textarea')
        const preview = el.querySelector('.carve-playground__live')
        const code = el.querySelector('.carve-playground__pane code')

        await waitFor(() => textarea.value === '*bold*', 'textarea seeded from the template source')
        await waitFor(() => preview.innerHTML === '<p><strong>bold</strong></p>', 'preview rendered on load')
        assert(code.textContent === '<p><strong>bold</strong></p>\\n', 'HTML view should show rendered HTML text')

        document.body.append(el)
        await delay(50)
        assert(textarea.value === '*bold*', 'reconnecting should not clear the editor')

        textarea.value = '/changed/'
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
        await waitFor(() => preview.innerHTML === '<p><em>changed</em></p>', 'typing updates the preview')
        assert(code.textContent === '<p><em>changed</em></p>\\n', 'HTML view should update as text')
        finish({ ok: true, textareaLength: textarea.value.length, preview: preview.innerHTML, htmlText: code.textContent })
      } catch (error) {
        finish({ ok: false, message: error instanceof Error ? error.message : String(error) })
      }
    </script>
  </body>
</html>`
}

class FakeNode {
  childNodes: FakeNode[] = []
  parentNode: FakeNode | null = null
  private text = ''

  get textContent(): string {
    return this.text || this.childNodes.map((child) => child.textContent).join('')
  }

  set textContent(value: string) {
    this.text = value
    this.childNodes = []
  }
}

class FakeElement extends FakeNode {
  attributes = new Map<string, string>()
  className = ''
  dataset: Record<string, string> = {}
  htmlFor = ''
  id = ''
  innerHTML = ''
  spellcheck = true
  value = ''
  checked = false
  name = ''
  type = ''
  listeners = new Map<string, Array<() => void>>()

  constructor(readonly tagName = '') {
    super()
  }

  append(...children: FakeNode[]) {
    for (const child of children) {
      child.parentNode = this
      this.childNodes.push(child)
    }
  }

  replaceChildren(...children: FakeNode[]) {
    this.childNodes = []
    this.append(...children)
  }

  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  querySelector(selector: string): FakeElement | null {
    return findElement(this, selector)
  }
}

class FakeTemplateElement extends FakeElement {
  content = new FakeNode()

  constructor(source: string) {
    super('template')
    this.dataset.carvePlaygroundSource = ''
    this.content.textContent = source
  }

  override get textContent(): string {
    return ''
  }
}

function matchesSelector(element: FakeElement, selector: string): boolean {
  if (selector === 'textarea') return element.tagName === 'textarea'
  if (selector === '.carve-playground__live') return element.className.split(' ').includes('carve-playground__live')
  if (selector === 'template[data-carve-playground-source]') return element instanceof FakeTemplateElement
  if (selector === '[data-carve-playground-rendered]') return 'carvePlaygroundRendered' in element.dataset
  if (selector === '[data-carve-playground-source-view]') return 'carvePlaygroundSourceView' in element.dataset
  return false
}

function findElement(root: FakeNode, selector: string): FakeElement | null {
  for (const child of root.childNodes) {
    if (child instanceof FakeElement && matchesSelector(child, selector)) return child
    const match = findElement(child, selector)
    if (match) return match
  }
  return null
}

const realGlobals = {
  customElements: globalThis.customElements,
  document: globalThis.document,
  HTMLElement: globalThis.HTMLElement,
  HTMLTemplateElement: globalThis.HTMLTemplateElement,
  window: globalThis.window,
}

afterEach(() => {
  Object.assign(globalThis, realGlobals)
})

describe('playground client', () => {
  it('seeds the editor from template content before replacing server-rendered children', async () => {
    const source = '*bold*'
    const rendered = '<p><strong>bold</strong></p>'
    const playgroundMarkup = carveToHtml(['::: playground', '```carve', source, '```', ':::'].join('\n'), {
      extensions: [playgroundExtension()],
    })
    expect(playgroundMarkup).toContain(`<template data-carve-playground-source>${source}</template>`)

    const registry = new Map<string, CustomElementConstructor>()
    Object.assign(globalThis, {
      HTMLElement: FakeElement,
      HTMLTemplateElement: FakeTemplateElement,
      customElements: {
        define(name: string, constructor: CustomElementConstructor) {
          registry.set(name, constructor)
        },
        get(name: string) {
          return registry.get(name)
        },
      },
      document: {
        createElement(tagName: string) {
          return new FakeElement(tagName)
        },
      },
      window: {
        clearTimeout,
        setTimeout,
      },
    })

    await import(`${pathToFileURL(resolve(import.meta.dirname, '../theme/playground.js')).href}?fake-dom=${Date.now()}`)
    const Playground = registry.get('carve-playground')
    expect(Playground).toBeDefined()

    const playground = new (Playground as CustomElementConstructor)() as FakeElement & { connectedCallback(): void }
    const template = new FakeTemplateElement(source)
    const sourceView = new FakeElement('div')
    sourceView.dataset.carvePlaygroundSourceView = ''
    sourceView.textContent = `${source}\n`
    const initialPreview = new FakeElement('div')
    initialPreview.dataset.carvePlaygroundRendered = ''
    initialPreview.innerHTML = rendered
    playground.append(template, sourceView, initialPreview)

    playground.connectedCallback()
    expect(playground.querySelector('template[data-carve-playground-source]')).toBeNull()
    expect(playground.querySelector('textarea')?.value).toBe(source)

    playground.connectedCallback()
    expect(playground.querySelector('textarea')?.value).toBe(source)
    await new Promise((resolveWait) => setTimeout(resolveWait, 50))
  })

  it('hydrates server-rendered playground markup before replacing fallback children', async () => {
    const bin = chromeBin()
    expect(bin, 'Chrome is required for the browser playground regression test').toBeDefined()
    if (!bin) return
    if (!(await canDriveChrome(bin))) return

    const playgroundMarkup = carveToHtml(['::: playground', '```carve', '*bold*', '```', ':::'].join('\n'), {
      extensions: [playgroundExtension()],
    })
    const playgroundScript = await readFile(resolve(import.meta.dirname, '../theme/playground.js'), 'utf8')
    const userDataDir = await mkdtemp(resolve(tmpdir(), 'cp-chrome-'))
    const fixtureDir = await mkdtemp(resolve(tmpdir(), 'cp-playground-client-'))
    const htmlPath = resolve(fixtureDir, 'index.html')
    const scriptPath = resolve(fixtureDir, 'assets/playground.js')
    const enginePath = resolve(fixtureDir, 'assets/carve/index.js')

    await mkdir(dirname(enginePath), { recursive: true })
    await writeFile(htmlPath, fixtureHtml(playgroundMarkup))
    await writeFile(scriptPath, playgroundScript)
    await writeFile(
      enginePath,
      `
export function carveToHtml(source) {
  if (source === '*bold*') return '<p><strong>bold</strong></p>'
  if (source === '/changed/') return '<p><em>changed</em></p>'
  return ''
}
`,
    )

    try {
      const { stdout } = await execFileAsync(
        bin,
        [
          ...chromeFlags,
          `--user-data-dir=${userDataDir}`,
          '--virtual-time-budget=3000',
          '--dump-dom',
          pathToFileURL(htmlPath).href,
        ],
        { maxBuffer: 1024 * 1024 * 5, timeout: 15000 },
      )

      const raw = stdout.match(/<pre id="result">(?<json>.*?)<\/pre>/s)?.groups?.json
      // finish() writes the JSON with textContent, so --dump-dom serializes it
      // with HTML escaping. Decode before parsing or every '<' in the captured
      // HTML arrives as '&lt;' and the comparison fails on the harness's own
      // round-trip rather than on the behavior under test.
      const result =
        raw === undefined
          ? undefined
          : raw
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/&quot;/g, '"')
              .replace(/&#39;/g, "'")
              .replace(/&amp;/g, '&')
      expect(result).toBeDefined()
      const parsed = JSON.parse(result ?? '{}') as { ok: boolean; message?: string }
      // Assert the harness message first: toMatchObject elides it, which turns a
      // precise in-page assertion failure into an unreadable shape mismatch.
      expect(parsed.message ?? 'ok').toBe('ok')
      expect(parsed).toMatchObject({
        ok: true,
        textareaLength: 9,
        preview: '<p><em>changed</em></p>',
        htmlText: '<p><em>changed</em></p>\n',
      })
    } finally {
      await rm(userDataDir, { force: true, recursive: true })
      await rm(fixtureDir, { force: true, recursive: true })
    }
  }, 20000)
})
