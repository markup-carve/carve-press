const engine = import('./carve/index.js').catch((error) => ({ __carveImportError: error }))
let nextId = 0

const EXTENSION_HOOKS = new Set([
  'afterParse',
  'beforeRender',
  'matchInline',
  'renderers',
  'inlineRenderers',
  'blockRenderers',
  'staticInlineRenderers',
  'staticBlockRenderers',
])

// These factories produce placeholders for tools/libraries the playground does
// not load. Enabling them would turn readable source into inert hydration shells.
export const PLAYGROUND_EXTENSION_EXCLUSIONS = {
  abc: 'requires a client-side ABC renderer that the playground does not load',
  chart: 'requires Chart.js, which is out of scope for the playground',
  d2: 'requires an external D2 renderer',
  graphviz: 'requires an external Graphviz renderer',
  mermaid: 'requires Mermaid, which is out of scope for the playground',
  plantuml: 'requires a PlantUML renderer',
  presets: 'aggregates excluded diagram/chart factories',
  vegaLite: 'requires Vega-Lite/Vega renderer',
  wavedrom: 'requires WaveDrom renderer',

  AstJsonDepthError: 'error class, not an extension factory',
  CANONICAL_ADMONITION_KINDS: 'constant, not an extension factory',
  CANONICAL_BLOCK_TYPES: 'constant, not an extension factory',
  CANONICAL_INLINE_TYPES: 'constant, not an extension factory',
  LIB_VERSION: 'constant, not an extension factory',
  LinkPolicy: 'class, not an extension factory',
  MAX_AST_JSON_DEPTH: 'constant, not an extension factory',
  Profile: 'class, not an extension factory',
  ProfileViolationError: 'error class, not an extension factory',
  SMART_PUNCTUATION_GLYPHS: 'constant, not an extension factory',
  SPEC_VERSION: 'constant, not an extension factory',
  applyMigrationFixes: 'migration utility, not an extension factory',
  applyProfile: 'profile utility, not an extension factory',
  buildMarker: 'stamp utility, not an extension factory',
  canonicalType: 'profile utility, not an extension factory',
  carveToAnsi: 'renderer entry point, not an extension factory',
  carveToAstJson: 'renderer entry point, not an extension factory',
  carveToCarve: 'renderer entry point, not an extension factory',
  carveToHtml: 'renderer entry point, not an extension factory',
  carveToMarkdown: 'renderer entry point, not an extension factory',
  carveToPlainText: 'renderer entry point, not an extension factory',
  compareSpecVersions: 'version utility, not an extension factory',
  defaultAttributes: 'site policy extension; the playground has no project defaults to apply',
  diffAst: 'AST utility, not an extension factory',
  djotMigrationWarnings: 'migration utility, not an extension factory',
  fencedRender: 'generic factory requiring host renderer choices',
  formatChanges: 'formatter utility, not an extension factory',
  formatLintWarnings: 'formatter utility, not an extension factory',
  formatMigrationWarnings: 'formatter utility, not an extension factory',
  formatProfileViolation: 'formatter utility, not an extension factory',
  fromAstJson: 'AST utility, not an extension factory',
  lintCarve: 'lint utility, not an extension factory',
  markdownToCarve: 'migration utility, not an extension factory',
  needsReview: 'stamp utility, not an extension factory',
  parse: 'parser entry point, not an extension factory',
  readStamp: 'stamp utility, not an extension factory',
  renderAnsi: 'renderer utility, not an extension factory',
  renderCarve: 'renderer utility, not an extension factory',
  renderHtml: 'renderer utility, not an extension factory',
  renderMarkdown: 'renderer utility, not an extension factory',
  renderPlainText: 'renderer utility, not an extension factory',
  resolve: 'resolver entry point, not an extension factory',
  sanitizeSvg: 'SVG utility, not an extension factory',
  stampCarve: 'stamp utility, not an extension factory',
  stripTrailingMarker: 'stamp utility, not an extension factory',
  tabNormalize: 'source transform utility, not an extension factory',
  toAstJson: 'AST utility, not an extension factory',
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
  if (
    extension &&
    typeof extension === 'object' &&
    typeof extension.name === 'string' &&
    Object.keys(extension).some((key) => EXTENSION_HOOKS.has(key))
  ) {
    return { kind: 'enabled' }
  }
  return { kind: 'unclassified' }
}

export function buildPlaygroundExtensions(mod) {
  const extensions = []
  for (const name of Object.keys(mod).sort()) {
    const classified = classifyEngineExport(name, mod[name])
    if (classified.kind !== 'enabled' && classified.kind !== 'throws') continue
    try {
      extensions.push(mod[name]())
    } catch (error) {
      console.error(`Carve playground extension "${name}" failed to initialize`, error)
    }
  }
  return extensions
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
    button.textContent = button.dataset.copyLabel ?? 'Copy'
  }, 1400)
}

function copyButton(label, getText) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'carve-playground__copy'
  button.dataset.copyLabel = 'Copy'
  button.textContent = 'Copy'
  button.setAttribute('aria-label', label)
  button.addEventListener('click', async () => {
    if (!navigator.clipboard?.writeText) {
      setButtonStatus(button, 'Unavailable')
      return
    }
    try {
      await navigator.clipboard.writeText(getText())
      setButtonStatus(button, 'Copied')
    } catch (error) {
      console.warn(`Carve playground copy failed: ${errorMessage(error)}`)
      setButtonStatus(button, 'Failed')
    }
  })
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
    htmlPane.className = 'carve-playground__pane'
    const pre = document.createElement('pre')
    const code = document.createElement('code')
    code.textContent = textWithFinalNewline(initialHtml)
    const htmlCopy = copyButton('Copy rendered HTML source', () => code.textContent ?? '')
    pre.append(code)
    htmlPane.append(htmlCopy, pre)

    const astPane = document.createElement('div')
    astPane.className = 'carve-playground__pane carve-playground__pane--ast'
    const astPre = document.createElement('pre')
    const astCode = document.createElement('code')
    astCode.textContent = '{}\n'
    const astCopy = copyButton('Copy AST JSON', () => astCode.textContent ?? '')
    astPre.append(astCode)
    astPane.append(astCopy, astPre)

    output.append(renderedRadio, renderedLabel, htmlRadio, htmlLabel, astRadio, astLabel, preview, htmlPane, astPane)
    this.replaceChildren(sourcePane, output)

    let token = 0
    let extensions
    const render = async () => {
      const current = ++token
      try {
        const mod = await engine
        if (mod.__carveImportError) throw mod.__carveImportError
        // The engine import is async, so this can resolve after the element has
        // been torn down - a navigation mid-render, or a test document being
        // disposed. Touching the DOM then throws an unhandled rejection.
        if (current !== token || !this.isConnected) return
        extensions ??= buildPlaygroundExtensions(mod)
        const options = { extensions }
        const html = mod.carveToHtml(textarea.value, options)
        const ast = mod.carveToAstJson(textarea.value, options)
        renderedContent.innerHTML = html
        code.textContent = textWithFinalNewline(html)
        astCode.textContent = `${JSON.stringify(ast, null, 2)}\n`
      } catch (error) {
        if (current !== token || !this.isConnected) return
        const message = this.ownerDocument.createElement('div')
        message.className = 'carve-playground__error'
        message.textContent = errorMessage(error)
        renderedContent.replaceChildren(message)
        code.textContent = `Error: ${errorMessage(error)}\n`
        astCode.textContent = `Error: ${errorMessage(error)}\n`
      }
    }

    textarea.addEventListener('input', debounce(render, 180))
    void render()
  }
}

globalThis.customElements?.define('carve-playground', CarvePlayground)
