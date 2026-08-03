import MiniSearch from './minisearch.js'

const root = document.querySelector('[data-search-root]')

if (root) {
  const input = root.querySelector('[data-search-input]')
  const panel = root.querySelector('[data-search-panel]')
  const resultsList = root.querySelector('[data-search-results]')
  const status = root.querySelector('[data-search-status]')

  if (
    input instanceof HTMLInputElement &&
    panel instanceof HTMLElement &&
    resultsList instanceof HTMLElement &&
    status instanceof HTMLElement
  ) {
    initSearch(root, input, panel, resultsList, status)
  }
}

function initSearch(root, input, panel, resultsList, status) {
  root.hidden = false

  let index = null
  let loading = null
  let recordsById = new Map()
  let results = []
  let active = -1

  const indexUrl = root.getAttribute('data-search-index') || '/assets/search-index.json'
  const siteRoot = siteRootFromIndex(indexUrl)

  function linkFor(record) {
    const route = String(record.route || '/').replace(/^\/+/, '')
    const slug = String(record.slug || '')
    const path = route === '' ? siteRoot : `${siteRoot}${route}`
    // A page-level record has no heading to jump to, so it links the page.
    return slug === '' ? path : `${path}#${encodeURIComponent(slug)}`
  }

  async function load() {
    if (index) return index
    loading ||= fetch(indexUrl)
      .then((response) => {
        if (!response.ok) throw new Error(`search index ${response.status}`)
        return response.json()
      })
      .then((payload) => {
        const records = Array.isArray(payload.records) ? payload.records : []
        recordsById = new Map(records.map((record) => [record.id, record]))
        const next = new MiniSearch({
          fields: ['title', 'heading', 'text'],
          storeFields: ['id'],
          searchOptions: {
            boost: { title: 6, heading: 3, text: 1 },
            fuzzy: 0.2,
            prefix: true,
          },
        })
        next.addAll(records)
        return next
      })
      .catch(() => {
        status.textContent = 'Search unavailable'
        return new MiniSearch({ fields: ['title', 'heading', 'text'] })
      })
    index = await loading
    return index
  }

  function setActive(next) {
    active = next
    const links = [...resultsList.querySelectorAll('a')]
    for (const [i, link] of links.entries()) {
      link.classList.toggle('is-active', i === active)
      if (i === active) link.scrollIntoView({ block: 'nearest' })
    }
  }

  function render() {
    resultsList.textContent = ''
    for (const record of results) {
      const item = document.createElement('li')
      const link = document.createElement('a')
      const title = document.createElement('span')
      const heading = document.createElement('span')
      link.href = linkFor(record)
      title.className = 'site-search__result-title'
      heading.className = 'site-search__result-section'
      title.textContent = String(record.title || '')
      heading.textContent = String(record.heading || '')
      link.append(title, heading)
      item.append(link)
      resultsList.append(item)
    }
    panel.hidden = results.length === 0
    status.textContent =
      input.value.trim() === ''
        ? ''
        : `${results.length} ${results.length === 1 ? 'result' : 'results'}`
    setActive(results.length === 0 ? -1 : 0)
  }

  async function search() {
    const query = input.value.trim()
    if (query === '') {
      results = []
      render()
      return
    }
    const docs = await load()
    // One result per page: a page now has a record of its own plus one per
    // section, and listing the same page three times pushes the other answers
    // off the list. Hits arrive best-first, so the first one wins - which is
    // also the most specific place to land.
    const seen = new Set()
    const matches = []
    for (const hit of docs.search(query)) {
      const record = recordsById.get(hit.id)
      if (record === undefined || seen.has(record.route)) continue
      seen.add(record.route)
      matches.push(record)
      if (matches.length === 8) break
    }
    results = matches
    render()
  }

  input.addEventListener('focus', () => void load())
  input.addEventListener('input', () => void search())
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      panel.hidden = true
      input.blur()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (results.length === 0) return
      event.preventDefault()
      const delta = event.key === 'ArrowDown' ? 1 : -1
      setActive((active + delta + results.length) % results.length)
      return
    }
    if (event.key === 'Enter' && active >= 0) {
      const link = resultsList.querySelectorAll('a')[active]
      if (link instanceof HTMLAnchorElement) link.click()
    }
  })

  document.addEventListener('keydown', (event) => {
    const target = event.target
    const typing =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    if (typing) return
    if (event.key === '/' || (event.key.toLowerCase() === 'k' && event.ctrlKey)) {
      event.preventDefault()
      input.focus()
    }
  })
}

function siteRootFromIndex(indexUrl) {
  const url = new URL(indexUrl, location.href)
  const marker = '/assets/'
  const cut = url.pathname.lastIndexOf(marker)
  return cut === -1 ? '/' : url.pathname.slice(0, cut + 1)
}
