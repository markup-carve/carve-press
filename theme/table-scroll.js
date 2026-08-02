(() => {
  const blocks = [...document.querySelectorAll('.table-scroll, .carve-compare')]
  if (blocks.length === 0) return

  const tolerance = 2
  const requestFrame =
    window.requestAnimationFrame?.bind(window) ?? ((callback) => window.setTimeout(callback, 16))
  let scheduled = false

  const measure = (block) => {
    const overflowing = block.scrollWidth - block.clientWidth > tolerance
    block.toggleAttribute('data-overflowing', overflowing)

    if (!overflowing) {
      block.style.removeProperty('--wide-block-height')
      return
    }

    const height = block.getBoundingClientRect().height
    if (height > 0) block.style.setProperty('--wide-block-height', `${height}px`)
  }

  const measureAll = () => {
    scheduled = false
    for (const block of blocks) measure(block)
  }

  const scheduleMeasure = () => {
    if (scheduled) return
    scheduled = true
    requestFrame(measureAll)
  }

  const Observer = window.ResizeObserver
  if (typeof Observer === 'function') {
    const observer = new Observer(scheduleMeasure)
    for (const block of blocks) {
      observer.observe(block)
      // Observe the CONTENT as well as the shell. The shell's width is fixed by
      // the layout and never changes, so watching only it misses the case that
      // matters most: a web font swapping in widens the table inside a shell
      // that stays exactly the same size.
      const content = block.firstElementChild
      if (content) observer.observe(content)
    }
  } else {
    window.addEventListener('resize', scheduleMeasure)
  }

  // `document.fonts.ready` can resolve before a stylesheet-imported face has
  // actually been applied, so the load event is a second, later chance.
  window.addEventListener('load', scheduleMeasure, { once: true })
  void document.fonts?.ready?.then(scheduleMeasure, () => {})
  // Measure synchronously the first time. requestAnimationFrame does not fire
  // while the tab is hidden, so deferring the initial pass leaves a background
  // tab permanently unmeasured - it only ever catches up if the reader happens
  // to resize. Coalescing via rAF is right for later passes, not the first.
  measureAll()
})()
