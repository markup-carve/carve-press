// Hydrates island mount points with modules the site supplies. CarvePress
// ships no framework: this file only decides when to import what the author
// configured, and hands it the element plus its props.
;(() => {
  const registry = window.__carvePressIslands ?? {}
  const mounted = new WeakSet()

  function props(element) {
    const raw = element.dataset.islandProps
    if (raw === undefined || raw === '') return {}
    try {
      return JSON.parse(raw)
    } catch (error) {
      console.warn(`carve-press: island "${element.dataset.island}" has unreadable props`, error)
      return {}
    }
  }

  async function hydrate(element) {
    if (mounted.has(element)) return
    const name = element.dataset.island
    const url = registry[name]
    if (url === undefined) {
      console.warn(`carve-press: no module registered for island "${name}"`)
      return
    }
    mounted.add(element)
    try {
      const module = await import(url)
      const mount = module.default ?? module.mount
      if (typeof mount !== 'function') {
        console.warn(`carve-press: island "${name}" module exports no mount function`)
        return
      }
      // The fallback stays until the module decides to replace it, so a slow
      // import shows the authored content rather than an empty box.
      await mount(element, props(element))
      element.dataset.islandReady = 'true'
    } catch (error) {
      console.warn(`carve-press: island "${name}" failed to hydrate`, error)
    }
  }

  function schedule(element) {
    const strategy = element.dataset.islandHydrate ?? 'load'
    if (strategy === 'idle') {
      if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(() => void hydrate(element))
      else window.setTimeout(() => void hydrate(element), 1)
      return
    }
    if (strategy === 'visible' && typeof IntersectionObserver === 'function') {
      const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          observer.disconnect()
          void hydrate(element)
        }
      })
      observer.observe(element)
      return
    }
    void hydrate(element)
  }

  for (const element of document.querySelectorAll('[data-island]')) schedule(element)
})()
