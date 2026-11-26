// The standard extensions ship in their own module. A site whose engine copy
// lacks it still gets a working core playground, only without extensions.
const engine = Promise.all([
  import('./carve/index.js'),
  import('./carve/extensions.js').catch((error) => {
    console.warn(`Carve playground extensions unavailable: ${errorMessage(error)}`)
    return {}
  }),
])
  .then(([core, extensions]) => ({ core, extensions }))
  .catch((error) => ({ __carveImportError: error }))
let nextId = 0
let mermaidSeq = 0
let chartSeq = 0
const scriptPromises = new Map()

function themeLabel(key, fallback) {
  return window.__carvePressLabels?.[key] ?? fallback
}

const CORE_ENTRY = 'core engine entry point, not an extension factory'
const CORE_CONSTANT = 'constant, not an extension factory'
const ERROR_CLASS = 'error class, not an extension factory'
const BUNDLE_PART = 'part of a bundle the playground assembles, not a factory'

// These factories produce placeholders for tools/libraries the playground does
// not load. Enabling them would turn readable source into inert hydration shells.
export const PLAYGROUND_EXTENSION_EXCLUSIONS = {
  abc: 'requires a client-side ABC renderer that the playground does not load',
  chart: 'requires Chart.js, enabled only when the site ships it',
  d2: 'requires an external D2 renderer',
  graphviz: 'requires an external Graphviz renderer',
  mermaid: 'requires Mermaid, enabled only when the site ships it',
  plantuml: 'requires a PlantUML renderer',
  presets: 'aggregates excluded diagram/chart factories',
  vegaLite: 'requires Vega-Lite/Vega renderer',
  wavedrom: 'requires WaveDrom renderer',

  // `@markup-carve/carve`
  AST_VERSION: CORE_CONSTANT,
  CarveInputError: ERROR_CLASS,
  CarveLayoutError: ERROR_CLASS,
  CarveOptionError: ERROR_CLASS,
  CarvePatchError: ERROR_CLASS,
  CarveRenderError: ERROR_CLASS,
  CarveTreeError: ERROR_CLASS,
  CarveWriteError: ERROR_CLASS,
  DEFAULT_DENIED_SCHEMES: CORE_CONSTANT,
  EditorChangeError: ERROR_CLASS,
  ImportInputError: ERROR_CLASS,
  LAYOUT_VERSION: CORE_CONSTANT,
  MAX_TREE_DEPTH: CORE_CONSTANT,
  NODE_TYPES: CORE_CONSTANT,
  RESERVED_WRITER_TARGETS: CORE_CONSTANT,
  SMART_PUNCTUATION: CORE_CONSTANT,
  SPEC_VERSION: CORE_CONSTANT,
  VERSION: CORE_CONSTANT,
  applyPatch: CORE_ENTRY,
  createEditorSession: CORE_ENTRY,
  createWriterRegistry: CORE_ENTRY,
  decodeTree: CORE_ENTRY,
  diffTree: CORE_ENTRY,
  encodeEnvelope: CORE_ENTRY,
  encodeTree: CORE_ENTRY,
  fix: CORE_ENTRY,
  fixEdits: CORE_ENTRY,
  fixableRules: CORE_ENTRY,
  flatten: CORE_ENTRY,
  format: CORE_ENTRY,
  formatWithDiagnostics: CORE_ENTRY,
  headingId: CORE_ENTRY,
  importDocument: CORE_ENTRY,
  includeDependencies: CORE_ENTRY,
  includeRegion: CORE_ENTRY,
  isUrlAllowed: CORE_ENTRY,
  lint: CORE_ENTRY,
  migrateTree: CORE_ENTRY,
  parse: CORE_ENTRY,
  parseWithDiagnostics: CORE_ENTRY,
  parseWithLayout: CORE_ENTRY,
  positionOf: CORE_ENTRY,
  render: CORE_ENTRY,
  renderWithDiagnostics: CORE_ENTRY,
  renderWithDocumentTransforms: CORE_ENTRY,
  sourceFingerprint: CORE_ENTRY,
  stringOffsetOfByte: CORE_ENTRY,
  tabsExtensions: BUNDLE_PART,
  tabsRenderer: BUNDLE_PART,
  treeFingerprint: CORE_ENTRY,
  treesEqual: CORE_ENTRY,
  tryRenderHtmlStreaming: CORE_ENTRY,
  urlScheme: CORE_ENTRY,
  utf8Length: CORE_ENTRY,
  validateLayout: CORE_ENTRY,
  validateTree: CORE_ENTRY,
  write: CORE_ENTRY,
  writeDocument: CORE_ENTRY,
  writeWithDiagnostics: CORE_ENTRY,

  // `@markup-carve/carve/extensions`
  SMART_QUOTE_LOCALES: CORE_CONSTANT,
  citeExtension: BUNDLE_PART,
  defaultAttributes: 'site policy extension; the playground has no project defaults to apply',
  detailsExtension: BUNDLE_PART,
  fencedRender: 'generic factory requiring host renderer choices',
  fencedRenderName: 'naming utility, not an extension factory',
  glossaryExtension: BUNDLE_PART,
  // A preview shows the source as written: these change every document, and
  // a page of this site asks for a table of contents with `::: toc`.
  headingLevelShift: 'site policy extension; it moves every heading of the source down',
  headingNumbers: 'site policy extension; it numbers headings the source does not number',
  glossaryRenderer: BUNDLE_PART,
  imgFenceExtensions: BUNDLE_PART,
  imgFenceRenderers: BUNDLE_PART,
  indexExtension: BUNDLE_PART,
  indexRenderer: BUNDLE_PART,
  indexTermExtension: BUNDLE_PART,
  indexTermRenderer: BUNDLE_PART,
  inlineFootnotesToParentheses: 'site policy extension; the site this playground mirrors keeps inline footnotes',
  isSmartQuoteLocaleSupported: 'smart-quote utility, not an extension factory',
  linkPolicy: 'site policy extension; the playground has no link policy to apply',
  referencesExtension: BUNDLE_PART,
  referencesRenderer: BUNDLE_PART,
  sanitizeSvg: 'SVG utility, not an extension factory',
  smartQuoteLocales: 'smart-quote utility, not an extension factory',
  // The playground exists to show what THIS site renders, and the site's stack
  // does not enable smart quotes, so enabling it only in the playground would
  // make the two disagree on the same source.
  smartQuotes: 'site policy extension; the site this playground mirrors does not enable smart quotes',
  spoilerBlockExtension: BUNDLE_PART,
  spoilerExtension: BUNDLE_PART,
  spoilerExtensions: BUNDLE_PART,
  standardTabsRenderer: 'renderer factory; tabs use the core tabsRenderer',
  tableOfContents: 'site policy extension; it inserts a table of contents the source does not ask for',
  tabNormalize: 'site policy extension; the site this playground mirrors keeps tabs in code',
  termExtension: BUNDLE_PART,
  termRenderer: BUNDLE_PART,
  tocRenderers: BUNDLE_PART,
  withExtensions: 'bundle merge utility, not an extension factory',
}

// A factory returning a bare definition needs these renderers registered with it.
const COMPANION_RENDERERS = {
  tableOfContents: 'tocRenderers',
  tocPlacement: 'tocRenderers',
}

function isDefinition(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof value.name === 'string' &&
    typeof value.version === 'string' &&
    typeof value.slots === 'object'
  )
}

function isBundle(value) {
  return value !== null && typeof value === 'object' && Array.isArray(value.extensions)
}

export function classifyEngineExport(name, value) {
  if (Object.hasOwn(PLAYGROUND_EXTENSION_EXCLUSIONS, name)) {
    return { kind: 'excluded', reason: PLAYGROUND_EXTENSION_EXCLUSIONS[name] }
  }
  if (typeof value !== 'function' || !/^[a-z]/.test(name) || value.length !== 0) {
    return { kind: 'unclassified' }
  }
  let extension
  try {
    extension = value()
  } catch (error) {
    return { kind: 'throws', error }
  }
  if (isBundle(extension) || isDefinition(extension)) return { kind: 'enabled' }
  return { kind: 'unclassified' }
}

function toBundle(name, made, mod) {
  if (isBundle(made)) {
    return {
      name,
      extensions: made.extensions,
      renderers: made.renderers ?? {},
      transforms: made.transforms ?? [],
    }
  }
  const companion = COMPANION_RENDERERS[name]
  return { name, extensions: [made], renderers: (companion && mod[companion]) || {}, transforms: [] }
}

/**
 * `mod` is the core entry and `@markup-carve/carve/extensions` in one namespace.
 * Each entry is a bundle named after the export it came from, in name order,
 * which is also the order the document transforms run in.
 */
export function buildPlaygroundExtensions(mod, available = {}) {
  const bundles = []
  if (Array.isArray(mod.tabsExtensions) && mod.tabsRenderer !== undefined) {
    bundles.push({
      name: 'tabs',
      extensions: mod.tabsExtensions,
      renderers: { 'carve.tabs': mod.tabsRenderer },
      transforms: [],
    })
  }
  for (const name of Object.keys(mod)) {
    const classified = classifyEngineExport(name, mod[name])
    // An exclusion states a missing runtime library, not a permanent verdict.
    // Once the site ships that library the extension is exactly what we want, so
    // its real markup reaches the renderer instead of a plain code block.
    const satisfied = classified.kind === 'excluded' && available[name] === true
    if (!satisfied && classified.kind !== 'enabled' && classified.kind !== 'throws') continue
    try {
      bundles.push(toBundle(name, mod[name](), mod))
    } catch (error) {
      console.error(`Carve playground extension "${name}" failed to initialize`, error)
    }
  }
  return bundles.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

function renderOptions(bundles) {
  const options = { extensions: [], renderers: {} }
  const transforms = []
  for (const bundle of bundles) {
    options.extensions.push(...bundle.extensions)
    Object.assign(options.renderers, bundle.renderers)
    transforms.push(...bundle.transforms)
  }
  return { options, transforms }
}

function debounce(fn, delay) {
  let timer = 0
  return () => {
    window.clearTimeout(timer)
    timer = window.setTimeout(fn, delay)
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function loadClassicScript(src, globalName, doc = document) {
  const resolved = new URL(src, doc.baseURI).href
  const cacheKey = `${globalName}:${resolved}`
  if (!scriptPromises.has(cacheKey)) {
    scriptPromises.set(
      cacheKey,
      new Promise((resolve, reject) => {
        const script = doc.createElement('script')
        script.src = resolved
        script.async = true
        script.onload = () => {
          const lib = globalThis[globalName]
          if (lib === undefined) {
            reject(new Error(`${globalName} global was not created by ${resolved}`))
            return
          }
          resolve(lib)
        }
        script.onerror = () => reject(new Error(`Failed to load ${resolved}`))
        doc.head.append(script)
      }),
    )
  }
  return scriptPromises.get(cacheKey)
}

function playgroundError(doc, message) {
  const node = doc.createElement('div')
  node.className = 'carve-playground__error'
  node.textContent = message
  return node
}

function mermaidTargetPre(el) {
  return el.tagName === 'PRE' ? el : el.parentElement
}

function initialSource(playground) {
  const template = playground.querySelector('template[data-carve-playground-source]')
  if (template instanceof HTMLTemplateElement) return template.content.textContent ?? ''

  return playground.querySelector('[data-carve-playground-source-view]')?.textContent ?? ''
}

function textWithFinalNewline(value) {
  return value.endsWith('\n') ? value : `${value}\n`
}

function setButtonStatus(button, text) {
  window.clearTimeout(button._carveCopyTimer)
  button.textContent = text
  button._carveCopyTimer = window.setTimeout(() => {
    button.textContent = button.dataset.copyLabel ?? themeLabel('copy', 'Copy')
  }, 1400)
}

function copyButton(label, getText) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'carve-playground__copy'
  button.dataset.copyLabel = themeLabel('copy', 'Copy')
  button.textContent = themeLabel('copy', 'Copy')
  button.setAttribute('aria-label', label)
  button.addEventListener('click', async () => {
    if (!navigator.clipboard?.writeText) {
      setButtonStatus(button, 'Unavailable')
      return
    }
    try {
      await navigator.clipboard.writeText(getText())
      setButtonStatus(button, themeLabel('copied', 'Copied'))
    } catch (error) {
      console.warn(`Carve playground copy failed: ${errorMessage(error)}`)
      setButtonStatus(button, 'Failed')
    }
  })
  return button
}

function engineButton(text, pressed) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'carve-playground__engine-button'
  button.textContent = text
  button.setAttribute('aria-pressed', pressed ? 'true' : 'false')
  return button
}

const HTMLElementBase = globalThis.HTMLElement ?? class {}

class CarvePlayground extends HTMLElementBase {
  connectedCallback() {
    if (this.dataset.enhanced === 'true') return
    this.dataset.enhanced = 'true'

    const source = initialSource(this)
    const initialHtml = this.querySelector('[data-carve-playground-rendered]')?.innerHTML ?? ''
    const id = `carve-playground-${++nextId}`

    const sourcePane = document.createElement('div')
    sourcePane.className = 'carve-playground__source carve-playground__source--editor'

    const label = document.createElement('label')
    label.className = 'carve-playground__editor-label'
    label.htmlFor = `${id}-source`
    label.textContent = 'Carve'

    const textarea = document.createElement('textarea')
    textarea.className = 'carve-playground__editor'
    textarea.id = `${id}-source`
    textarea.spellcheck = false
    textarea.value = source
    const sourceCopy = copyButton('Copy Carve source', () => textarea.value)

    sourcePane.append(label, sourceCopy, textarea)

    const output = document.createElement('div')
    output.className = 'carve-playground__output'

    const wasmUrl = this.dataset.playgroundWasm
    let engineControl
    let jsEngineButton
    let rustEngineButton
    let engineStatus
    if (wasmUrl !== undefined) {
      engineControl = document.createElement('div')
      engineControl.className = 'carve-playground__engine'
      engineControl.title = 'Rust rendering uses carve-rs built-in extensions; HTML and AST tabs use JavaScript.'
      jsEngineButton = engineButton('JS', true)
      rustEngineButton = engineButton('Rust', false)
      engineStatus = document.createElement('span')
      engineStatus.className = 'carve-playground__engine-status'
      engineStatus.textContent = 'JS engine'
      engineControl.append(jsEngineButton, rustEngineButton, engineStatus)
    }

    const renderedRadio = document.createElement('input')
    renderedRadio.type = 'radio'
    renderedRadio.name = id
    renderedRadio.id = `${id}-rendered`
    renderedRadio.className = 'carve-playground__radio'
    renderedRadio.checked = true

    const renderedLabel = document.createElement('label')
    renderedLabel.className = 'carve-playground__label'
    renderedLabel.htmlFor = renderedRadio.id
    renderedLabel.textContent = 'Rendered'

    const htmlRadio = document.createElement('input')
    htmlRadio.type = 'radio'
    htmlRadio.name = id
    htmlRadio.id = `${id}-html`
    htmlRadio.className = 'carve-playground__radio'

    const htmlLabel = document.createElement('label')
    htmlLabel.className = 'carve-playground__label'
    htmlLabel.htmlFor = htmlRadio.id
    htmlLabel.textContent = 'HTML'

    const astRadio = document.createElement('input')
    astRadio.type = 'radio'
    astRadio.name = id
    astRadio.id = `${id}-ast`
    astRadio.className = 'carve-playground__radio'

    const astLabel = document.createElement('label')
    astLabel.className = 'carve-playground__label'
    astLabel.htmlFor = astRadio.id
    astLabel.textContent = 'AST'

    const preview = document.createElement('div')
    preview.className = 'carve-playground__pane carve-playground__live'
    const renderedCopy = copyButton('Copy rendered HTML', () => code.textContent ?? '')
    const renderedContent = document.createElement('div')
    renderedContent.className = 'carve-playground__rendered'
    renderedContent.innerHTML = initialHtml
    preview.append(renderedCopy, renderedContent)

    const htmlPane = document.createElement('div')
    htmlPane.className = 'carve-playground__pane carve-playground__pane--html'
    const htmlNote = document.createElement('p')
    htmlNote.className = 'carve-playground__engine-note'
    const pre = document.createElement('pre')
    const code = document.createElement('code')
    code.textContent = textWithFinalNewline(initialHtml)
    const htmlCopy = copyButton('Copy rendered HTML source', () => code.textContent ?? '')
    pre.append(code)
    htmlPane.append(htmlCopy, htmlNote, pre)

    const astPane = document.createElement('div')
    astPane.className = 'carve-playground__pane carve-playground__pane--ast'
    const astNote = document.createElement('p')
    astNote.className = 'carve-playground__engine-note'
    const astPre = document.createElement('pre')
    const astCode = document.createElement('code')
    astCode.textContent = '{}\n'
    const astCopy = copyButton('Copy AST JSON', () => astCode.textContent ?? '')
    astPre.append(astCode)
    astPane.append(astCopy, astNote, astPre)

    output.append(
      ...(engineControl === undefined ? [] : [engineControl]),
      renderedRadio,
      renderedLabel,
      htmlRadio,
      htmlLabel,
      astRadio,
      astLabel,
      preview,
      htmlPane,
      astPane,
    )
    this.replaceChildren(sourcePane, output)

    let token = 0
    let stack
    let selectedEngine = 'js'
    let wasmToken = 0
    let wasmModule
    let wasmModulePromise
    let charts = []
    // A failure has to outlive the re-render it triggers. render() reports the
    // active engine on every pass, so without this the message set here is
    // overwritten a tick later by a routine "JS engine" and the reader is left
    // with no sign that anything went wrong.
    let engineError

    const setEngineControl = (status, isError = false) => {
      jsEngineButton?.setAttribute('aria-pressed', selectedEngine === 'js' ? 'true' : 'false')
      rustEngineButton?.setAttribute('aria-pressed', selectedEngine === 'rust' ? 'true' : 'false')
      if (engineStatus !== undefined && status !== undefined) {
        engineStatus.textContent = status
        engineStatus.dataset.error = isError ? 'true' : 'false'
      }
      htmlNote.textContent =
        selectedEngine === 'rust' ? 'HTML tab uses the JavaScript engine.' : ''
      astNote.textContent =
        selectedEngine === 'rust' ? 'AST tab uses the JavaScript engine; Rust exposes no AST binding.' : ''
    }

    const loadWasmModule = async () => {
      if (wasmUrl === undefined) throw new Error('Rust engine is not configured')
      // The URL comes from a data attribute, so it belongs to document space. A
      // bare dynamic import would resolve a relative value against THIS module
      // (assets/playground.js) instead, quietly turning ./assets/x into
      // assets/assets/x.
      const resolved = new URL(wasmUrl, this.ownerDocument.baseURI).href
      wasmModulePromise ??= import(resolved).then(async (mod) => {
        if (typeof mod.default !== 'function') throw new Error('Rust engine has no default init export')
        await mod.default()
        if (typeof mod.toHtmlFull !== 'function') throw new Error('Rust engine has no toHtmlFull export')
        return mod
      })
      return wasmModulePromise
    }

    const stillCurrent = (current) => current === token && this.isConnected

    const destroyCharts = () => {
      for (const chart of charts) {
        try {
          chart.destroy()
        } catch (error) {
          console.warn(`Carve playground chart cleanup failed: ${errorMessage(error)}`)
        }
      }
      charts = []
    }

    const renderMermaid = async (current) => {
      const mermaidUrl = this.dataset.playgroundMermaid
      if (mermaidUrl === undefined) return
      const blocks = Array.from(renderedContent.querySelectorAll('pre.mermaid, pre > code.language-mermaid'))
      if (blocks.length === 0) return
      let mermaid
      try {
        mermaid = await loadClassicScript(mermaidUrl, 'mermaid', this.ownerDocument)
      } catch (error) {
        if (!stillCurrent(current)) return
        for (const el of blocks) {
          const pre = mermaidTargetPre(el)
          if (pre?.isConnected) pre.replaceWith(playgroundError(this.ownerDocument, errorMessage(error)))
        }
        return
      }
      if (!stillCurrent(current)) return
      try {
        const dark = this.ownerDocument.documentElement.dataset.theme === 'dark'
        // Loose mode is acceptable here: the playground renders text the reader
        // typed into their own browser plus authored samples from this site, not
        // third-party content.
        mermaid.initialize({ startOnLoad: false, securityLevel: 'loose', theme: dark ? 'dark' : 'default' })
      } catch (error) {
        if (!stillCurrent(current)) return
        for (const el of blocks) {
          const pre = mermaidTargetPre(el)
          if (pre?.isConnected) pre.replaceWith(playgroundError(this.ownerDocument, errorMessage(error)))
        }
        return
      }
      for (const el of blocks) {
        const pre = mermaidTargetPre(el)
        if (pre === null || !renderedContent.contains(pre)) continue
        const definition = el.textContent ?? ''
        try {
          const { svg } = await mermaid.render(`carve-mermaid-${mermaidSeq++}`, definition)
          if (!stillCurrent(current) || !pre.isConnected || !renderedContent.contains(pre)) return
          const figure = this.ownerDocument.createElement('div')
          figure.className = 'mermaid-rendered'
          figure.innerHTML = svg
          pre.replaceWith(figure)
        } catch {
          // A broken diagram is still useful source; leave the code block in place.
        }
      }
    }

    const renderCharts = async (current) => {
      const chartUrl = this.dataset.playgroundChart
      if (chartUrl === undefined) return
      // `div.chart` is the chart extension's output; `pre > code.language-chart`
      // is the plain code block the Rust engine emits, which has no such
      // extension. Mermaid already handles both forms, and a chart that renders
      // under one engine and not the other is the kind of inconsistency a reader
      // reads as a bug.
      const blocks = Array.from(
        renderedContent.querySelectorAll('div.chart, pre > code.language-chart'),
      )
      if (blocks.length === 0) return
      let Chart
      try {
        Chart = await loadClassicScript(chartUrl, 'Chart', this.ownerDocument)
      } catch (error) {
        if (!stillCurrent(current)) return
        for (const block of blocks) {
          if (block.isConnected) block.replaceChildren(playgroundError(this.ownerDocument, errorMessage(error)))
        }
        return
      }
      if (!stillCurrent(current)) return
      for (const block of blocks) {
        if (!renderedContent.contains(block)) continue
        // A code block carries its config as text; the extension's div wraps it
        // in a JSON script tag. Either way the config is read, never evaluated.
        const isCodeBlock = block.tagName === 'CODE'
        const source = isCodeBlock
          ? block.textContent
          : block.querySelector('script[type="application/json"]')?.textContent
        if (source === undefined || source === null) continue
        let config
        try {
          config = JSON.parse(source)
        } catch {
          continue
        }
        const host = isCodeBlock ? block.parentElement : block
        if (host === null) continue
        const canvas = this.ownerDocument.createElement('canvas')
        canvas.id = `carve-chart-${chartSeq++}`
        host.replaceChildren(canvas)
        try {
          const chart = new Chart(canvas, config)
          if (!stillCurrent(current) || !host.isConnected || !renderedContent.contains(host)) {
            chart.destroy()
            return
          }
          charts.push(chart)
        } catch (error) {
          host.replaceChildren(playgroundError(this.ownerDocument, errorMessage(error)))
        }
      }
    }

    const renderRuntimeAssets = async (current) => {
      await renderMermaid(current)
      if (!stillCurrent(current)) return
      await renderCharts(current)
    }

    const render = async () => {
      const current = ++token
      destroyCharts()
      try {
        const mod = await engine
        if (mod.__carveImportError) throw mod.__carveImportError
        // The engine import is async, so this can resolve after the element has
        // been torn down - a navigation mid-render, or a test document being
        // disposed. Touching the DOM then throws an unhandled rejection.
        if (current !== token || !this.isConnected) return
        const { core } = mod
        stack ??= renderOptions(
          buildPlaygroundExtensions(
            { ...core, ...mod.extensions },
            {
              mermaid: this.dataset.playgroundMermaid !== undefined,
              chart: this.dataset.playgroundChart !== undefined,
            },
          ),
        )
        const { options, transforms } = stack
        const jsHtml =
          transforms.length > 0 && typeof core.renderWithDocumentTransforms === 'function'
            ? core.renderWithDocumentTransforms(textarea.value, transforms, options).html
            : core.render(textarea.value, options)
        const ast = core.encodeTree(core.parse(textarea.value, { extensions: options.extensions }))
        let previewHtml = jsHtml
        if (selectedEngine === 'rust' && wasmModule !== undefined) {
          try {
            previewHtml = wasmModule.toHtmlFull(textarea.value)
            setEngineControl('Rust engine')
          } catch (error) {
            selectedEngine = 'js'
            engineError = `Rust render failed: ${errorMessage(error)}`
            setEngineControl(engineError, true)
            previewHtml = jsHtml
          }
        } else if (engineError !== undefined) {
          setEngineControl(engineError, true)
        } else {
          setEngineControl('JS engine')
        }
        renderedContent.innerHTML = previewHtml
        code.textContent = textWithFinalNewline(jsHtml)
        astCode.textContent = `${JSON.stringify(JSON.parse(ast), null, 2)}\n`
        await renderRuntimeAssets(current)
      } catch (error) {
        if (current !== token || !this.isConnected) return
        renderedContent.replaceChildren(playgroundError(this.ownerDocument, errorMessage(error)))
        code.textContent = `Error: ${errorMessage(error)}\n`
        astCode.textContent = `Error: ${errorMessage(error)}\n`
      }
    }

    jsEngineButton?.addEventListener('click', () => {
      selectedEngine = 'js'
      engineError = undefined
      setEngineControl('JS engine')
      void render()
    })

    rustEngineButton?.addEventListener('click', async () => {
      const current = ++wasmToken
      rustEngineButton.disabled = true
      engineError = undefined
      setEngineControl('Loading Rust...')
      try {
        const mod = await loadWasmModule()
        if (current !== wasmToken || !this.isConnected) return
        wasmModule = mod
        selectedEngine = 'rust'
        engineError = undefined
        setEngineControl('Rust engine')
        void render()
      } catch (error) {
        if (current !== wasmToken || !this.isConnected) return
        wasmModulePromise = undefined
        wasmModule = undefined
        selectedEngine = 'js'
        engineError = `Rust load failed: ${errorMessage(error)}`
        setEngineControl(engineError, true)
        void render()
      } finally {
        if (current === wasmToken && this.isConnected) rustEngineButton.disabled = false
      }
    })

    textarea.addEventListener('input', debounce(render, 180))
    void render()
  }
}

globalThis.customElements?.define('carve-playground', CarvePlayground)
