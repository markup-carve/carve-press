(() => {
  const root = document.querySelector('[data-search-root]')
  if (!root) return

  const input = root.querySelector('[data-search-input]')
  const panel = root.querySelector('[data-search-panel]')
  const resultsList = root.querySelector('[data-search-results]')
  const status = root.querySelector('[data-search-status]')
  if (!(input instanceof HTMLInputElement) || !panel || !resultsList || !status) return

  root.hidden = false

  let records = null
  let loading = null
  let results = []
  let active = -1

  const indexUrl = root.getAttribute('data-search-index') || '/assets/search-index.json'
  const siteRoot = (() => {
    const url = new URL(indexUrl, location.href)
    const marker = '/assets/'
    const cut = url.pathname.lastIndexOf(marker)
    return cut === -1 ? '/' : url.pathname.slice(0, cut + 1)
  })()

  const linkFor = (record) => {
    const route = String(record.route || '/').replace(/^\/+/, '')
    const slug = String(record.slug || '')
    const path = route === '' ? siteRoot : `${siteRoot}${route}`
    return `${path}#${encodeURIComponent(slug)}`
  }

  const load = async () => {
    if (records) return records
    loading ||= fetch(indexUrl)
      .then((response) => {
        if (!response.ok) throw new Error(`search index ${response.status}`)
        return response.json()
      })
      .then((payload) => (Array.isArray(payload.records) ? payload.records : []))
      .catch(() => {
        status.textContent = 'Search unavailable'
        return []
      })
    records = await loading
    return records
  }

  const score = (record, terms) => {
    const title = String(record.title || '').toLowerCase()
    const heading = String(record.heading || '').toLowerCase()
    const text = String(record.text || '').toLowerCase()
    let total = 0
    for (const term of terms) {
      if (heading.includes(term)) total += 8
      if (title.includes(term)) total += 4
      if (text.includes(term)) total += 1
      if (!heading.includes(term) && !title.includes(term) && !text.includes(term)) return 0
    }
    return total
  }

  const setActive = (next) => {
    active = next
    const links = [...resultsList.querySelectorAll('a')]
    for (const [i, link] of links.entries()) {
      link.classList.toggle('is-active', i === active)
      if (i === active) link.scrollIntoView({ block: 'nearest' })
    }
  }

  const render = () => {
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

  const search = async () => {
    const terms = input.value.toLowerCase().trim().split(/\s+/).filter(Boolean)
    if (terms.length === 0) {
      results = []
      render()
      return
    }
    const docs = await load()
    results = docs
      .map((record) => ({ record, score: score(record, terms) }))
      .filter((hit) => hit.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map((hit) => hit.record)
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
})()
