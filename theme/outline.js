(() => {
  const links = [...document.querySelectorAll('.outline a[href^="#"]')]
  if (links.length === 0) return

  const outline = links[0]?.closest('.outline')
  const entries = links
    .map((link) => {
      const href = link.getAttribute('href')
      if (href === null || !href.startsWith('#')) return undefined
      const target = document.getElementById(href.slice(1))
      return target === null ? undefined : { link, target }
    })
    .filter(Boolean)
  if (entries.length === 0) return

  const requestFrame =
    window.requestAnimationFrame?.bind(window) ?? ((callback) => window.setTimeout(callback, 16))
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')
  let active = null
  let scheduled = false

  const scrollActiveIntoView = (link) => {
    if (!outline || typeof outline.getBoundingClientRect !== 'function') return
    const outlineRect = outline.getBoundingClientRect()
    const linkRect = link.getBoundingClientRect()
    let top = outline.scrollTop

    if (linkRect.top < outlineRect.top) {
      top -= outlineRect.top - linkRect.top
    } else if (linkRect.bottom > outlineRect.bottom) {
      top += linkRect.bottom - outlineRect.bottom
    } else {
      return
    }

    const behavior = reduceMotion?.matches ? 'auto' : 'smooth'
    if (typeof outline.scrollTo === 'function') outline.scrollTo({ top, behavior })
    else outline.scrollTop = top
  }

  const setActive = (next) => {
    if (next === active) return
    for (const { link } of entries) link.removeAttribute('aria-current')
    next.setAttribute('aria-current', 'true')
    active = next
    scrollActiveIntoView(next)
  }

  const atPageBottom = () => {
    const doc = document.documentElement
    const body = document.body
    const scrollTop = window.scrollY ?? window.pageYOffset ?? doc.scrollTop ?? body?.scrollTop ?? 0
    const viewportHeight = window.innerHeight ?? doc.clientHeight
    const scrollHeight = Math.max(doc.scrollHeight, body?.scrollHeight ?? 0)
    return scrollTop + viewportHeight >= scrollHeight - 1
  }

  const update = () => {
    scheduled = false

    if (atPageBottom()) {
      setActive(entries[entries.length - 1].link)
      return
    }

    const readingLine = (window.innerHeight ?? document.documentElement.clientHeight) * 0.28
    let next = entries[0].link
    for (const { link, target } of entries) {
      if (target.getBoundingClientRect().top > readingLine) break
      next = link
    }
    setActive(next)
  }

  const scheduleUpdate = () => {
    if (scheduled) return
    scheduled = true
    requestFrame(update)
  }

  window.addEventListener('scroll', scheduleUpdate, { passive: true })
  window.addEventListener('resize', scheduleUpdate)
  update()
})()
