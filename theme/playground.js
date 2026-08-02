const engine = import('./carve/index.js')
let nextId = 0

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

class CarvePlayground extends HTMLElement {
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

    sourcePane.append(label, textarea)

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

    const preview = document.createElement('div')
    preview.className = 'carve-playground__pane carve-playground__live'
    preview.innerHTML = initialHtml

    const htmlPane = document.createElement('div')
    htmlPane.className = 'carve-playground__pane'
    const pre = document.createElement('pre')
    const code = document.createElement('code')
    code.textContent = initialHtml.endsWith('\n') ? initialHtml : `${initialHtml}\n`
    pre.append(code)
    htmlPane.append(pre)

    output.append(renderedRadio, renderedLabel, htmlRadio, htmlLabel, preview, htmlPane)
    this.replaceChildren(sourcePane, output)

    let token = 0
    const render = async () => {
      const current = ++token
      try {
        const mod = await engine
        // The engine import is async, so this can resolve after the element has
        // been torn down - a navigation mid-render, or a test document being
        // disposed. Touching the DOM then throws an unhandled rejection.
        if (current !== token || !this.isConnected) return
        const html = mod.carveToHtml(textarea.value)
        preview.innerHTML = html
        code.textContent = html.endsWith('\n') ? html : `${html}\n`
      } catch (error) {
        if (current !== token || !this.isConnected) return
        const message = this.ownerDocument.createElement('div')
        message.className = 'carve-playground__error'
        message.textContent = errorMessage(error)
        preview.replaceChildren(message)
        code.textContent = `Error: ${errorMessage(error)}\n`
      }
    }

    textarea.addEventListener('input', debounce(render, 180))
    void render()
  }
}

customElements.define('carve-playground', CarvePlayground)
