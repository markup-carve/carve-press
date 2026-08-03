(() => {
  const mobile = window.matchMedia('(max-width: 820px)')
  const toggles = [...document.querySelectorAll('[data-drawer-toggle]')]
  const scrim = document.querySelector('[data-drawer-scrim]')
  const drawers = new Map()
  let openKind
  let restoreFocus

  const focusableSelector = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',')

  for (const toggle of toggles) {
    const kind = toggle.getAttribute('data-drawer-toggle')
    const id = toggle.getAttribute('aria-controls')
    const drawer = id === null ? null : document.getElementById(id)
    if (kind !== null && drawer !== null) drawers.set(kind, { toggle, drawer })
  }

  function setClosed(entry) {
    entry.toggle.setAttribute('aria-expanded', 'false')
    entry.drawer.removeAttribute('data-drawer-open')
    if (mobile.matches) {
      entry.drawer.hidden = true
      entry.drawer.inert = true
    } else {
      entry.drawer.hidden = false
      entry.drawer.inert = false
    }
  }

  function focusFirst(drawer) {
    const first = drawer.querySelector(focusableSelector)
    if (first instanceof HTMLElement) first.focus()
  }

  function closeDrawer({ restore = true } = {}) {
    if (openKind === undefined) return
    const entry = drawers.get(openKind)
    if (entry !== undefined) setClosed(entry)
    openKind = undefined
    if (scrim !== null) scrim.hidden = true
    document.documentElement.removeAttribute('data-drawer-lock')
    if (restore && restoreFocus instanceof HTMLElement) restoreFocus.focus()
    restoreFocus = undefined
  }

  function openDrawer(kind) {
    if (!mobile.matches) return
    const entry = drawers.get(kind)
    if (entry === undefined) return
    closeDrawer({ restore: false })
    openKind = kind
    restoreFocus = entry.toggle
    entry.toggle.setAttribute('aria-expanded', 'true')
    entry.drawer.hidden = false
    entry.drawer.inert = false
    entry.drawer.setAttribute('data-drawer-open', '')
    if (scrim !== null) scrim.hidden = false
    document.documentElement.setAttribute('data-drawer-lock', '')
    focusFirst(entry.drawer)
  }

  function syncMode() {
    if (!mobile.matches) {
      closeDrawer({ restore: false })
      if (scrim !== null) scrim.hidden = true
    }
    for (const entry of drawers.values()) setClosed(entry)
  }

  function trapFocus(event) {
    if (event.key !== 'Tab' || openKind === undefined) return
    const entry = drawers.get(openKind)
    if (entry === undefined) return
    const items = [...entry.drawer.querySelectorAll(focusableSelector)].filter((item) => {
      return item instanceof HTMLElement && !item.hidden && !item.inert
    })
    if (items.length === 0) {
      event.preventDefault()
      entry.drawer.focus()
      return
    }
    const first = items[0]
    const last = items.at(-1)
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  for (const [kind, entry] of drawers) {
    entry.toggle.addEventListener('click', () => {
      if (openKind === kind) closeDrawer()
      else openDrawer(kind)
    })
    entry.drawer.addEventListener('click', (event) => {
      const target = event.target
      if (target instanceof Element && target.closest('a[href]') !== null) closeDrawer({ restore: false })
    })
  }

  if (scrim !== null) scrim.addEventListener('click', () => closeDrawer())
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeDrawer()
    else trapFocus(event)
  })
  mobile.addEventListener('change', syncMode)
  syncMode()
})()
