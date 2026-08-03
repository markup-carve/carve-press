(() => {
  const copyText = async (text) => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }

    if (typeof document.execCommand !== 'function') return false
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0'
    document.body.appendChild(textarea)
    textarea.select()
    try {
      return document.execCommand('copy')
    } catch {
      return false
    } finally {
      textarea.remove()
    }
  }

  const shouldSkip = (block) =>
    block.closest('.carve-playground') !== null ||
    (block.closest('.carve-compare__pane') !== null && block.closest('.carve-compare__source') === null)

  for (const block of document.querySelectorAll('.code-block')) {
    const button = block.querySelector('.code-block__copy')
    const source = block.querySelector('template[data-code-block-copy]')
    if (!(button instanceof HTMLButtonElement) || !(source instanceof HTMLTemplateElement)) continue
    if (shouldSkip(block)) {
      button.remove()
      continue
    }

    // The button is an icon now, so the state change is the accessible name and
    // a data attribute the stylesheet swaps icons on, not the text content.
    const label = button.getAttribute('aria-label') || 'Copy code'
    const copiedLabel = button.dataset.copiedLabel || 'Copied'
    let timeout
    button.addEventListener('click', () => {
      void copyText(source.content?.textContent ?? source.textContent ?? '')
        .then((copied) => {
          if (!copied) return
          button.setAttribute('aria-label', copiedLabel)
          button.dataset.copied = 'true'
          window.clearTimeout(timeout)
          timeout = window.setTimeout(() => {
            button.setAttribute('aria-label', label)
            delete button.dataset.copied
          }, 2000)
        })
        .catch(() => {})
    })
  }
})()
