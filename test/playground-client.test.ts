import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import * as carveEngine from '@markup-carve/carve'
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
        const rendered = el.querySelector('.carve-playground__rendered')
        const code = el.querySelector('.carve-playground__pane:not(.carve-playground__live) code')
        const astText = () => el.querySelector('.carve-playground__pane--ast code')?.textContent ?? ''
        const buttons = [...el.querySelectorAll('button')]

        await waitFor(() => textarea.value === '*bold*', 'textarea seeded from the template source')
        assert(!el.querySelector('.carve-playground__engine'), 'engine control should be absent without WASM config')
        await waitFor(() => rendered.innerHTML === '<p><strong>bold</strong></p>', 'preview rendered on load')
        assert(code.textContent === '<p><strong>bold</strong></p>\\n', 'HTML view should show rendered HTML text')
        await waitFor(() => astText().includes('*bold*'), 'AST view reflects the initial source')
        assert(JSON.parse(astText()).type === 'document', 'AST view should contain a parseable document node')
        assert(buttons.length >= 3, 'copy buttons should exist for source, HTML, and AST panes')
        assert(
          buttons.some((button) => button.type === 'button' && button.getAttribute('aria-label') === 'Copy Carve source'),
          'source copy button should be a labeled button',
        )
        assert(
          buttons.some((button) => button.type === 'button' && button.getAttribute('aria-label') === 'Copy rendered HTML source'),
          'HTML copy button should be a labeled button',
        )

        document.body.append(el)
        await delay(50)
        assert(textarea.value === '*bold*', 'reconnecting should not clear the editor')

        textarea.value = '::: details\\nbody\\n:::'
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
        await waitFor(() => rendered.innerHTML.includes('<details>'), 'typing an extension construct updates the preview')
        assert(rendered.innerHTML.includes('<summary>Details</summary>'), 'details extension should render distinguishing markup')
        assert(code.textContent.includes('<details>'), 'HTML view should update as text')
        await waitFor(() => astText().includes('details'), 'AST view reflects the edited source')
        assert(JSON.parse(astText()).type === 'document', 'AST view should stay parseable after an edit')
        finish({
          ok: true,
          textareaLength: textarea.value.length,
          preview: rendered.innerHTML,
          htmlText: code.textContent,
          astRootType: JSON.parse(astText()).type,
          buttons: buttons.map((button) => ({ tag: button.tagName, type: button.type, label: button.getAttribute('aria-label') })),
        })
      } catch (error) {
        finish({ ok: false, message: error instanceof Error ? error.message : String(error) })
      }
    </script>
  </body>
</html>`
}

function wasmFixtureHtml(playgroundMarkup: string, mode: 'success' | 'fail'): string {
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
          for (let i = 0; i < 100; i++) {
            if (predicate()) return
            await delay(50)
          }
          throw new Error('timed out waiting for: ' + what)
        }

        await import('./assets/playground.js')
        await customElements.whenDefined('carve-playground')
        const el = document.querySelector('carve-playground')
        const rendered = el.querySelector('.carve-playground__rendered')
        const engine = el.querySelector('.carve-playground__engine')
        const buttons = [...engine.querySelectorAll('button')]
        const jsButton = buttons.find((button) => button.textContent === 'JS')
        const rustButton = buttons.find((button) => button.textContent === 'Rust')
        const status = engine.querySelector('.carve-playground__engine-status')
        const htmlNote = el.querySelector('.carve-playground__pane:not(.carve-playground__live) .carve-playground__engine-note')
        const astNote = el.querySelector('.carve-playground__pane--ast .carve-playground__engine-note')
        const htmlText = () => el.querySelector('.carve-playground__pane:not(.carve-playground__live) code')?.textContent ?? ''

        assert(engine, 'engine control should be present with WASM config')
        await waitFor(() => rendered.innerHTML === '<p><strong>bold</strong></p>', 'initial JS preview rendered')
        rustButton.click()
        ${mode === 'success'
          ? `
        await waitFor(() => rendered.innerHTML === '<p>rust:*bold*</p>', 'Rust preview rendered')
        assert(window.__wasmInitCount === 1, 'Rust module init should run once')
        assert(window.__rustRenderCount >= 1, 'Rust render binding should be called')
        assert(jsButton.getAttribute('aria-pressed') === 'false', 'JS button should not be pressed after Rust selection')
        assert(rustButton.getAttribute('aria-pressed') === 'true', 'Rust button should be pressed after selection')
        assert(htmlText() === '<p><strong>bold</strong></p>\\n', 'HTML tab should keep JS output')
        assert(htmlNote.textContent.includes('JavaScript engine'), 'HTML note should disclose JS engine')
        assert(astNote.textContent.includes('Rust exposes no AST'), 'AST note should disclose JS AST')
        jsButton.click()
        await waitFor(() => rendered.innerHTML === '<p><strong>bold</strong></p>', 'switching back to JS rerenders')
        rustButton.click()
        await waitFor(() => rendered.innerHTML === '<p>rust:*bold*</p>', 'switching to Rust again rerenders')
        assert(window.__wasmInitCount === 1, 'Rust module should be loaded once')
        finish({ ok: true, status: status.textContent, initCount: window.__wasmInitCount, preview: rendered.innerHTML })
          `
          : `
        await waitFor(() => status.textContent.includes('Rust load failed'), 'Rust load failure surfaced on control')
        assert(rendered.innerHTML === '<p><strong>bold</strong></p>', 'JS preview should remain visible after Rust load failure')
        assert(jsButton.getAttribute('aria-pressed') === 'true', 'JS button should remain pressed after Rust failure')
        assert(rustButton.getAttribute('aria-pressed') === 'false', 'Rust button should not remain selected after failure')
        finish({ ok: true, status: status.textContent, preview: rendered.innerHTML })
          `}
      } catch (error) {
        finish({ ok: false, message: error instanceof Error ? error.message : String(error) })
      }
    </script>
  </body>
</html>`
}

function runtimeFixtureHtml(playgroundMarkup: string, script: string): string {
  const safeScript = script.replace(/<\/script/gi, '<\\/script')
  return `<!doctype html>
<html>
  <head></head>
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
      const waitFor = async (predicate, what) => {
        for (let i = 0; i < 120; i++) {
          if (predicate()) return
          await delay(50)
        }
        throw new Error('timed out waiting for: ' + what)
      }

      try {
        await import('./assets/playground.js')
        await customElements.whenDefined('carve-playground')
        ${safeScript}
      } catch (error) {
        finish({ ok: false, message: error instanceof Error ? error.message : String(error) })
      }
    </script>
  </body>
</html>`
}

function decodeDumpedResult(stdout: string): string | undefined {
  const raw = stdout.match(/<pre id="result">(?<json>.*?)<\/pre>/s)?.groups?.json
  return raw
    ?.replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}


/**
 * Chrome dumps the DOM when its virtual-time budget is exhausted, and virtual
 * time advances at full speed while the page is idle - including through the
 * in-page poll loops, which burn tens of virtual seconds in an instant. The
 * budget therefore has to sit far above the worst-case total polling time, or
 * the page is cut off by its own waiting. Under CPU contention the
 * page's real work - a module load, a diagram parse - can still be pending when
 * the budget runs out, so the in-page script never writes its result and the
 * failure reads as "no result" rather than as anything about the behavior. One
 * retry turns that machine-load artifact back into a real signal; a genuine
 * failure still produces a result, with its message, on the first run.
 */
async function dumpFixture(bin: string, htmlPath: string, userDataDir: string): Promise<string | undefined> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { stdout } = await execFileAsync(
      bin,
      [
        ...chromeFlags,
        `--user-data-dir=${userDataDir}`,
        '--virtual-time-budget=600000',
        '--dump-dom',
        pathToFileURL(htmlPath).href,
      ],
      { maxBuffer: 1024 * 1024 * 5, timeout: 60000 },
    )
    const result = decodeDumpedResult(stdout)
    if (result !== undefined) return result
  }
  return undefined
}

async function runRuntimeFixture(
  playgroundMarkup: string,
  fixtureScript: string,
  assets: Record<string, string>,
): Promise<Record<string, unknown>> {
  const bin = chromeBin()
  expect(bin, 'Chrome is required for the browser playground regression test').toBeDefined()
  if (!bin || !(await canDriveChrome(bin))) return { skipped: true }

  const playgroundScript = await readFile(resolve(import.meta.dirname, '../theme/playground.js'), 'utf8')
  const userDataDir = await mkdtemp(resolve(tmpdir(), 'cp-chrome-'))
  const fixtureDir = await mkdtemp(resolve(tmpdir(), 'cp-playground-runtime-'))
  const htmlPath = resolve(fixtureDir, 'index.html')
  const scriptPath = resolve(fixtureDir, 'assets/playground.js')
  const enginePath = resolve(fixtureDir, 'assets/carve/index.js')

  await mkdir(dirname(enginePath), { recursive: true })
  await writeFile(htmlPath, runtimeFixtureHtml(playgroundMarkup, fixtureScript))
  await writeFile(scriptPath, playgroundScript)
  for (const [assetPath, contents] of Object.entries(assets)) {
    const resolved = resolve(fixtureDir, assetPath)
    await mkdir(dirname(resolved), { recursive: true })
    await writeFile(resolved, contents)
  }

  try {
    const result = await dumpFixture(bin, htmlPath, userDataDir)
    expect(result).toBeDefined()
    const parsed = JSON.parse(result ?? '{}') as Record<string, unknown> & { ok?: boolean; message?: string }
    expect(parsed.message ?? 'ok').toBe('ok')
    expect(parsed.ok).toBe(true)
    return parsed
  } finally {
    await rm(userDataDir, { force: true, recursive: true })
    await rm(fixtureDir, { force: true, recursive: true })
  }
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

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value)
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
  navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'),
  window: globalThis.window,
}

afterEach(() => {
  Object.assign(globalThis, {
    customElements: realGlobals.customElements,
    document: realGlobals.document,
    HTMLElement: realGlobals.HTMLElement,
    HTMLTemplateElement: realGlobals.HTMLTemplateElement,
    window: realGlobals.window,
  })
  if (realGlobals.navigator) Object.defineProperty(globalThis, 'navigator', realGlobals.navigator)
})

describe('playground client', () => {
  it('classifies every current engine export for the playground extension stack', async () => {
    const mod = await import(`${pathToFileURL(resolve(import.meta.dirname, '../theme/playground.js')).href}?classify=${Date.now()}`)
    const classify = mod.classifyEngineExport as (name: string, value: unknown) => { kind: string; reason?: string }
    const build = mod.buildPlaygroundExtensions as (engine: Record<string, unknown>) => Array<{ name: string }>
    const exclusions = mod.PLAYGROUND_EXTENSION_EXCLUSIONS as Record<string, string>
    const unclassified = Object.entries(carveEngine)
      .filter(([name, value]) => {
        const result = classify(name, value)
        return result.kind === 'unclassified'
      })
      .map(([name]) => name)

    expect(unclassified).toEqual([])
    expect(exclusions.mermaid).toMatch(/Mermaid/)
    expect(build(carveEngine as Record<string, unknown>).map((extension) => extension.name)).toEqual([
      'autolink',
      'citations',
      'codeCallouts',
      'code-group',
      'color',
      'details',
      'external-links',
      'glossary',
      'heading-level-shift',
      'headingNumbers',
      'heading-permalinks',
      'heading-reference',
      'img-fence',
      'index',
      'list-table',
      'math-block',
      'spoiler',
      'table-of-contents',
      'tabs',
      'toc',
      'wikilinks',
    ])
  })

  it('fails the drift guard for an unclassified engine export', async () => {
    const mod = await import(`${pathToFileURL(resolve(import.meta.dirname, '../theme/playground.js')).href}?drift=${Date.now()}`)
    const classify = mod.classifyEngineExport as (name: string, value: unknown) => { kind: string }

    expect(classify('newPublicHelper', () => ({ nope: true }))).toEqual({ kind: 'unclassified' })
  })

  it('skips an extension whose construction throws', async () => {
    const mod = await import(`${pathToFileURL(resolve(import.meta.dirname, '../theme/playground.js')).href}?throws=${Date.now()}`)
    const build = mod.buildPlaygroundExtensions as (engine: Record<string, unknown>) => Array<{ name: string }>
    const errors: unknown[] = []
    const realConsoleError = console.error
    console.error = (...args: unknown[]) => {
      errors.push(args)
    }

    try {
      const extensions = build({
        details: carveEngine.details,
        broken() {
          throw new Error('boom')
        },
      })
      expect(extensions.map((extension) => extension.name)).toEqual(['details'])
      expect(errors).toHaveLength(1)
      expect(String((errors[0] as unknown[])[0])).toContain('broken')
    } finally {
      console.error = realConsoleError
    }
  })

  it('seeds the editor from template content before replacing server-rendered children', async () => {
    const source = '*bold*'
    const rendered = '<p><strong>bold</strong></p>'
    const playgroundMarkup = carveToHtml(['::: playground', '```carve', source, '```', ':::'].join('\n'), {
      extensions: [playgroundExtension()],
    })
    expect(playgroundMarkup).toContain(`<template data-carve-playground-source>${source}</template>`)

    const registry = new Map<string, CustomElementConstructor>()
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} })
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
export function carveToHtml(source, opts = {}) {
  if (source === '*bold*') return '<p><strong>bold</strong></p>'
  if (source === '::: details\\nbody\\n:::') {
    return opts.extensions?.some((extension) => extension.name === 'details')
      ? '<details>\\n  <summary>Details</summary>\\n  <p>body</p>\\n</details>'
      : '<div class="details">\\n  <p>body</p>\\n</div>'
  }
  return ''
}
export function carveToAstJson(source) {
  return { type: 'document', children: [{ type: 'text', value: source }] }
}
export function details() {
  return { name: 'details', blockRenderers: {} }
}
export function broken() {
  throw new Error('boom')
}
`,
    )

    try {
      const dumped = await dumpFixture(bin, htmlPath, userDataDir)

      const result = dumped
      expect(result).toBeDefined()
      const parsed = JSON.parse(result ?? '{}') as { ok: boolean; message?: string }
      // Assert the harness message first: toMatchObject elides it, which turns a
      // precise in-page assertion failure into an unreadable shape mismatch.
      expect(parsed.message ?? 'ok').toBe('ok')
      expect(parsed).toMatchObject({
        ok: true,
        // Derived, not a literal: a hand-written length silently stops matching
        // the moment the typed source changes.
        textareaLength: '::: details\nbody\n:::'.length,
        preview: '<details>\n  <summary>Details</summary>\n  <p>body</p>\n</details>',
        htmlText: '<details>\n  <summary>Details</summary>\n  <p>body</p>\n</details>\n',
        astRootType: 'document',
      })
      expect(parsed).toHaveProperty('buttons')
    } finally {
      await rm(userDataDir, { force: true, recursive: true })
      await rm(fixtureDir, { force: true, recursive: true })
    }
  }, 90000)

  it('loads Mermaid only for configured previews with matching blocks and renders both emitted forms', async () => {
    const engineSource = `
export function carveToHtml(source) {
  if (source === 'none') return '<p>No diagram</p>'
  if (source === 'code') return '<pre><code class="language-mermaid">graph LR; A-->B</code></pre>'
  return '<pre class="mermaid">graph LR; A-->B</pre>'
}
export function carveToAstJson(source) {
  return { type: 'document', source }
}
`
    const mermaidSource = `
window.__mermaidLoads = (window.__mermaidLoads ?? 0) + 1
globalThis.mermaid = {
  initialize(options) { window.__mermaidTheme = options.theme },
  async render(id, definition) {
    window.__mermaidRenders = (window.__mermaidRenders ?? 0) + 1
    return { svg: '<svg data-id="' + id + '"><text>' + definition.replace(/</g, '&lt;') + '</text></svg>' }
  },
}
`
    const configured = carveToHtml(
      [
        '::: playground',
        '```carve',
        'pre',
        '```',
        ':::',
        '::: playground',
        '```carve',
        'code',
        '```',
        ':::',
        '::: playground',
        '```carve',
        'none',
        '```',
        ':::',
      ].join('\n'),
      { extensions: [playgroundExtension({ mermaid: './assets/mermaid.min.js' })] },
    )
    const parsed = await runRuntimeFixture(
      configured,
      `
        const rendered = [...document.querySelectorAll('.carve-playground__rendered')]
        await waitFor(() => rendered.filter((el) => el.querySelector('.mermaid-rendered')).length === 2, 'two mermaid blocks rendered')
        finish({
          ok: true,
          loads: window.__mermaidLoads ?? 0,
          renders: window.__mermaidRenders ?? 0,
          first: rendered[0].innerHTML,
          second: rendered[1].innerHTML,
          third: rendered[2].innerHTML,
          theme: window.__mermaidTheme,
        })
      `,
      {
        'assets/carve/index.js': engineSource,
        'assets/mermaid.min.js': mermaidSource,
      },
    )
    if (parsed.skipped) return
    expect(parsed.loads).toBe(1)
    expect(parsed.renders).toBe(2)
    expect(parsed.first).toContain('mermaid-rendered')
    expect(parsed.second).toContain('mermaid-rendered')
    expect(parsed.third).toBe('<p>No diagram</p>')
    expect(parsed.theme).toBe('default')

    const absent = carveToHtml(['::: playground', '```carve', 'pre', '```', ':::'].join('\n'), {
      extensions: [playgroundExtension()],
    })
    const absentParsed = await runRuntimeFixture(
      absent,
      `
        const rendered = document.querySelector('.carve-playground__rendered')
        await waitFor(() => rendered.innerHTML.includes('mermaid'), 'plain mermaid block rendered')
        finish({
          ok: true,
          loads: window.__mermaidLoads ?? 0,
          scriptCount: document.querySelectorAll('script[src$="mermaid.min.js"]').length,
          html: rendered.innerHTML,
        })
      `,
      {
        'assets/carve/index.js': engineSource,
        'assets/mermaid.min.js': mermaidSource,
      },
    )
    if (absentParsed.skipped) return
    expect(absentParsed.loads).toBe(0)
    expect(absentParsed.scriptCount).toBe(0)
    expect(absentParsed.html).toContain('<pre class="mermaid">')
  }, 90000)

  it('leaves Mermaid parse errors as readable source and discards stale async diagrams', async () => {
    const engineSource = `
export function carveToHtml(source) {
  return '<pre class="mermaid">' + source.replace(/</g, '&lt;') + '</pre>'
}
export function carveToAstJson(source) {
  return { type: 'document', source }
}
`
    const mermaidSource = `
window.__mermaidLoads = (window.__mermaidLoads ?? 0) + 1
globalThis.mermaid = {
  initialize() {},
  async render(id, definition) {
    window.__mermaidDefinitions = [...(window.__mermaidDefinitions ?? []), definition]
    if (definition === 'bad') throw new Error('parse failed')
    await new Promise((resolve) => setTimeout(resolve, definition === 'old' ? 500 : 0))
    return { svg: '<svg><text>svg-' + definition + '</text></svg>' }
  },
}
`
    const parseError = carveToHtml(['::: playground', '```carve', 'bad', '```', ':::'].join('\n'), {
      extensions: [playgroundExtension({ mermaid: './assets/mermaid.min.js' })],
    })
    const parseParsed = await runRuntimeFixture(
      parseError,
      `
        const rendered = document.querySelector('.carve-playground__rendered')
        await waitFor(() => (window.__mermaidDefinitions ?? []).includes('bad'), 'mermaid parse attempted')
        finish({ ok: true, html: rendered.innerHTML, loads: window.__mermaidLoads ?? 0 })
      `,
      {
        'assets/carve/index.js': engineSource,
        'assets/mermaid.min.js': mermaidSource,
      },
    )
    if (parseParsed.skipped) return
    expect(parseParsed.loads).toBe(1)
    expect(parseParsed.html).toContain('<pre class="mermaid">bad</pre>')

    const stale = carveToHtml(['::: playground', '```carve', 'old', '```', ':::'].join('\n'), {
      extensions: [playgroundExtension({ mermaid: './assets/mermaid.min.js' })],
    })
    const staleParsed = await runRuntimeFixture(
      stale,
      `
        const el = document.querySelector('carve-playground')
        const textarea = el.querySelector('textarea')
        const rendered = el.querySelector('.carve-playground__rendered')
        await waitFor(() => textarea.value === 'old', 'textarea ready')
        textarea.value = 'new'
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
        await waitFor(() => rendered.innerHTML.includes('svg-new'), 'new mermaid render committed')
        await delay(650)
        finish({ ok: true, html: rendered.innerHTML, definitions: window.__mermaidDefinitions })
      `,
      {
        'assets/carve/index.js': engineSource,
        'assets/mermaid.min.js': mermaidSource,
      },
    )
    if (staleParsed.skipped) return
    expect(staleParsed.html).toContain('svg-new')
    expect(staleParsed.html).not.toContain('svg-old')
  }, 90000)

  it('renders Chart.js JSON configs, preserves invalid JSON, and destroys prior instances on re-render', async () => {
    const engineSource = `
export function carveToHtml(source) {
  if (source === 'invalid') return '<div class="chart"><script type="application/json">{bad</script></div>'
  return '<div class="chart"><script type="application/json">{"type":"bar","data":{"labels":["' + source + '"],"datasets":[{"data":[1]}]}}</script></div>'
}
export function carveToAstJson(source) {
  return { type: 'document', source }
}
`
    const chartSource = `
window.__chartLoads = (window.__chartLoads ?? 0) + 1
globalThis.Chart = function Chart(canvas, config) {
  window.__chartConstructs = [...(window.__chartConstructs ?? []), config.data.labels[0]]
  canvas.dataset.chartType = config.type
  this.destroy = () => {
    window.__chartDestroys = (window.__chartDestroys ?? 0) + 1
  }
}
`
    const valid = carveToHtml(['::: playground', '```carve', 'one', '```', ':::'].join('\n'), {
      extensions: [playgroundExtension({ chart: './assets/chart.umd.js' })],
    })
    const validParsed = await runRuntimeFixture(
      valid,
      `
        const el = document.querySelector('carve-playground')
        const textarea = el.querySelector('textarea')
        const rendered = el.querySelector('.carve-playground__rendered')
        await waitFor(() => rendered.querySelector('canvas')?.dataset.chartType === 'bar', 'chart canvas rendered')
        textarea.value = 'two'
        textarea.dispatchEvent(new Event('input', { bubbles: true }))
        await waitFor(() => (window.__chartConstructs ?? []).includes('two'), 'second chart constructed')
        finish({
          ok: true,
          loads: window.__chartLoads ?? 0,
          constructs: window.__chartConstructs,
          destroys: window.__chartDestroys ?? 0,
          canvasCount: rendered.querySelectorAll('canvas').length,
        })
      `,
      {
        'assets/carve/index.js': engineSource,
        'assets/chart.umd.js': chartSource,
      },
    )
    if (validParsed.skipped) return
    expect(validParsed.loads).toBe(1)
    expect(validParsed.constructs).toEqual(['one', 'two'])
    expect(validParsed.destroys).toBe(1)
    expect(validParsed.canvasCount).toBe(1)

    const invalid = carveToHtml(['::: playground', '```carve', 'invalid', '```', ':::'].join('\n'), {
      extensions: [playgroundExtension({ chart: './assets/chart.umd.js' })],
    })
    const invalidParsed = await runRuntimeFixture(
      invalid,
      `
        const rendered = document.querySelector('.carve-playground__rendered')
        await waitFor(() => rendered.querySelector('script[type="application/json"]'), 'raw chart script remains')
        finish({
          ok: true,
          loads: window.__chartLoads ?? 0,
          constructs: window.__chartConstructs ?? [],
          html: rendered.innerHTML,
        })
      `,
      {
        'assets/carve/index.js': engineSource,
        'assets/chart.umd.js': chartSource,
      },
    )
    if (invalidParsed.skipped) return
    expect(invalidParsed.loads).toBe(1)
    expect(invalidParsed.constructs).toEqual([])
    expect(invalidParsed.html).toContain('<script type="application/json">{bad</script>')

    const absent = carveToHtml(['::: playground', '```carve', 'one', '```', ':::'].join('\n'), {
      extensions: [playgroundExtension()],
    })
    const absentParsed = await runRuntimeFixture(
      absent,
      `
        const rendered = document.querySelector('.carve-playground__rendered')
        await waitFor(() => rendered.querySelector('div.chart'), 'raw chart block rendered')
        finish({
          ok: true,
          loads: window.__chartLoads ?? 0,
          scriptCount: document.querySelectorAll('script[src$="chart.umd.js"]').length,
          html: rendered.innerHTML,
        })
      `,
      {
        'assets/carve/index.js': engineSource,
        'assets/chart.umd.js': chartSource,
      },
    )
    if (absentParsed.skipped) return
    expect(absentParsed.loads).toBe(0)
    expect(absentParsed.scriptCount).toBe(0)
    expect(absentParsed.html).toContain('<div class="chart">')
  }, 90000)

  it('shows a Rust engine control only when WASM is configured and lazy-renders through toHtmlFull', async () => {
    const bin = chromeBin()
    expect(bin, 'Chrome is required for the browser playground regression test').toBeDefined()
    if (!bin) return
    if (!(await canDriveChrome(bin))) return

    const playgroundMarkup = carveToHtml(['::: playground', '```carve', '*bold*', '```', ':::'].join('\n'), {
      extensions: [playgroundExtension({ wasm: './assets/carve-wasm/carve_wasm.js' })],
    })
    const playgroundScript = await readFile(resolve(import.meta.dirname, '../theme/playground.js'), 'utf8')
    const userDataDir = await mkdtemp(resolve(tmpdir(), 'cp-chrome-'))
    const fixtureDir = await mkdtemp(resolve(tmpdir(), 'cp-playground-wasm-'))
    const htmlPath = resolve(fixtureDir, 'index.html')
    const scriptPath = resolve(fixtureDir, 'assets/playground.js')
    const enginePath = resolve(fixtureDir, 'assets/carve/index.js')
    const wasmPath = resolve(fixtureDir, 'assets/carve-wasm/carve_wasm.js')

    await mkdir(dirname(enginePath), { recursive: true })
    await mkdir(dirname(wasmPath), { recursive: true })
    await writeFile(htmlPath, wasmFixtureHtml(playgroundMarkup, 'success'))
    await writeFile(scriptPath, playgroundScript)
    await writeFile(
      enginePath,
      `
export function carveToHtml() {
  return '<p><strong>bold</strong></p>'
}
export function carveToAstJson(source) {
  return { type: 'document', children: [{ type: 'text', value: source }] }
}
`,
    )
    await writeFile(
      wasmPath,
      `
globalThis.__wasmModuleEvaluations = (globalThis.__wasmModuleEvaluations ?? 0) + 1
export default async function init() {
  globalThis.__wasmInitCount = (globalThis.__wasmInitCount ?? 0) + 1
}
export function toHtmlFull(source) {
  globalThis.__rustRenderCount = (globalThis.__rustRenderCount ?? 0) + 1
  return '<p>rust:' + source + '</p>'
}
`,
    )

    try {
      const dumped = await dumpFixture(bin, htmlPath, userDataDir)
      const result = dumped
      expect(result).toBeDefined()
      const parsed = JSON.parse(result ?? '{}') as { ok: boolean; message?: string }
      expect(parsed.message ?? 'ok').toBe('ok')
      expect(parsed).toMatchObject({
        ok: true,
        initCount: 1,
        preview: '<p>rust:*bold*</p>',
      })
    } finally {
      await rm(userDataDir, { force: true, recursive: true })
      await rm(fixtureDir, { force: true, recursive: true })
    }
  }, 90000)

  it('surfaces a failing Rust load on the control and keeps the JavaScript preview', async () => {
    const bin = chromeBin()
    expect(bin, 'Chrome is required for the browser playground regression test').toBeDefined()
    if (!bin) return
    if (!(await canDriveChrome(bin))) return

    const playgroundMarkup = carveToHtml(['::: playground', '```carve', '*bold*', '```', ':::'].join('\n'), {
      extensions: [playgroundExtension({ wasm: './assets/carve-wasm/carve_wasm.js' })],
    })
    const playgroundScript = await readFile(resolve(import.meta.dirname, '../theme/playground.js'), 'utf8')
    const userDataDir = await mkdtemp(resolve(tmpdir(), 'cp-chrome-'))
    const fixtureDir = await mkdtemp(resolve(tmpdir(), 'cp-playground-wasm-fail-'))
    const htmlPath = resolve(fixtureDir, 'index.html')
    const scriptPath = resolve(fixtureDir, 'assets/playground.js')
    const enginePath = resolve(fixtureDir, 'assets/carve/index.js')
    const wasmPath = resolve(fixtureDir, 'assets/carve-wasm/carve_wasm.js')

    await mkdir(dirname(enginePath), { recursive: true })
    await mkdir(dirname(wasmPath), { recursive: true })
    await writeFile(htmlPath, wasmFixtureHtml(playgroundMarkup, 'fail'))
    await writeFile(scriptPath, playgroundScript)
    await writeFile(
      enginePath,
      `
export function carveToHtml() {
  return '<p><strong>bold</strong></p>'
}
export function carveToAstJson(source) {
  return { type: 'document', children: [{ type: 'text', value: source }] }
}
`,
    )
    await writeFile(
      wasmPath,
      `
export default async function init() {
  throw new Error('no wasm today')
}
export function toHtmlFull() {
  return '<p>unreachable</p>'
}
`,
    )

    try {
      const dumped = await dumpFixture(bin, htmlPath, userDataDir)
      const result = dumped
      expect(result).toBeDefined()
      const parsed = JSON.parse(result ?? '{}') as { ok: boolean; message?: string; status?: string }
      expect(parsed.message ?? 'ok').toBe('ok')
      expect(parsed.ok).toBe(true)
      expect(parsed.status).toContain('Rust load failed')
      expect(parsed).toMatchObject({ preview: '<p><strong>bold</strong></p>' })
    } finally {
      await rm(userDataDir, { force: true, recursive: true })
      await rm(fixtureDir, { force: true, recursive: true })
    }
  }, 90000)
})
