
// Classic scrollbars take layout space; overlay scrollbars do not. Measure once
// rather than assuming, and publish it so the expanded state can pad by exactly
// the space the scrollbar gave up. This is a device constant - unlike a measured
// element height, it does not go stale when a web font swaps in.
const publishScrollbarThickness = (doc) => {
  // Measuring is an enhancement; it must never throw and take the marking
  // pass down with it. Without it the custom property stays unset and the
  // compensation falls back to 0, which is what an overlay-scrollbar
  // platform wants anyway.
  if (typeof doc.createElement !== 'function' || !doc.body) return
  const probe = doc.createElement('div')
  probe.style.cssText = 'position:absolute;visibility:hidden;overflow-x:scroll;width:100px;height:100px'
  probe.appendChild(doc.createElement('div')).style.cssText = 'width:200px;height:1px'
  doc.body.appendChild(probe)
  const thickness = probe.offsetHeight - probe.clientHeight
  probe.remove()
  doc.documentElement.style.setProperty('--scrollbar-h', `${thickness}px`)
}
(() => {
  const blocks = [...document.querySelectorAll('.table-scroll, .carve-compare')]
  if (blocks.length === 0) return

  const GUTTER = 32
  const tolerance = 2
  const requestFrame =
    window.requestAnimationFrame?.bind(window) ?? ((callback) => window.setTimeout(callback, 16))
  let scheduled = false

  const measure = (block) => {
    // Expansion is offered only when the content's natural width genuinely
    // fits the space to the right of the block. Expanding into less room than
    // that would re-wrap the table into a different - and differently tall -
    // layout, which is the jump this design exists to avoid.
    const clipped = block.scrollWidth - block.clientWidth > tolerance
    const room = block.ownerDocument.documentElement.clientWidth - block.getBoundingClientRect().left - GUTTER
    const overflowing = clipped && block.scrollWidth <= room
    block.toggleAttribute('data-overflowing', overflowing)

    // No height is recorded on purpose. Pinning a measured height goes stale the
    // moment a web font swaps in and re-lays the table, and the expanded state
    // no longer needs one: the table does not re-wrap between states.
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
  publishScrollbarThickness(document)
  measureAll()
})()
