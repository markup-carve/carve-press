import type {
  CarvePressConfig,
  HeadTag,
  NavItem,
  SidebarGroup,
  SidebarItem,
  SocialLink,
  ThemeLogo,
} from '../config.js'
import type { RenderedPage } from '../render/page.js'
import type { FlatLink } from '../nav.js'
import { sanitizeSvg } from '@markup-carve/carve'
import { BuildError } from '../errors.js'
import { htmlDocument, escapeAttr, escapeText, withBase } from './shell.js'

export { htmlDocument }

export interface LayoutContext {
  config: CarvePressConfig
  rendered: RenderedPage
  sidebar: SidebarGroup[]
  prev?: FlatLink
  next?: FlatLink
  lastUpdated?: Date
}

export type Layout = (ctx: LayoutContext) => string

interface HomeHeroImage {
  src?: unknown
  alt?: unknown
}

interface HomeHeroAction {
  theme?: unknown
  text?: unknown
  link?: unknown
}

interface HomeHero {
  name?: unknown
  text?: unknown
  tagline?: unknown
  image?: unknown
  actions?: unknown
}

interface HomeFeature {
  title?: unknown
  details?: unknown
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function homeHeroActionValue(value: unknown): HomeHeroAction | undefined {
  const record = objectValue(value)
  return record === undefined ? undefined : record
}

function homeFeatureValue(value: unknown): HomeFeature | undefined {
  const record = objectValue(value)
  return record === undefined ? undefined : record
}

function navLinkHtml(item: NavItem, base: string, current: string, className: string): string {
  if (item.link === undefined) return `<span class="${className}">${escapeText(item.text)}</span>`
  const href = item.link.startsWith('/') ? withBase(base, item.link) : item.link
  return `<a class="${className}" href="${escapeAttr(href)}"${
    item.link === current ? ' aria-current="page"' : ''
  }>${escapeText(item.text)}</a>`
}

function dropdownHtml(item: NavItem, base: string, current: string): string {
  const children = item.items ?? []
  const links = children
    .map((child) => `<li>${navLinkHtml(child, base, current, 'site-nav__dropdown-link')}</li>`)
    .join('')
  const currentAttr = item.link === current ? ' aria-current="page"' : ''
  return `<details class="site-nav__dropdown"><summary${currentAttr}>${escapeText(
    item.text,
  )}</summary><ul>${links}</ul></details>`
}

export function headerNavHtml(items: NavItem[], base: string, current: string): string {
  if (items.length === 0) return ''
  const links = items
    .map((item) => {
      const body =
        item.items === undefined
          ? navLinkHtml(item, base, current, 'site-nav__link')
          : dropdownHtml(item, base, current)
      return `<li class="site-nav__item">${body}</li>`
    })
    .join('')
  return `<nav class="site-nav" id="site-nav-drawer" aria-label="Primary" data-mobile-drawer="nav"><ul>${links}</ul></nav>`
}

const SOCIAL_ICONS: Record<string, string> = {
  github:
    '<path fill="currentColor" d="M8 0C3.58 0 0 3.67 0 8.2c0 3.63 2.29 6.7 5.47 7.79.4.07.55-.18.55-.4 0-.2-.01-.86-.01-1.56-2.01.38-2.53-.5-2.69-.96-.09-.23-.48-.96-.82-1.15-.28-.16-.68-.55-.01-.56.63-.01 1.08.59 1.23.83.72 1.24 1.87.89 2.33.68.07-.53.28-.89.51-1.09-1.78-.21-3.64-.91-3.64-4.04 0-.89.31-1.62.82-2.19-.08-.21-.36-1.04.08-2.16 0 0 .67-.22 2.2.84A7.42 7.42 0 0 1 8 3.96c.68 0 1.36.09 2 .27 1.52-1.06 2.19-.84 2.19-.84.44 1.12.16 1.95.08 2.16.51.57.82 1.3.82 2.19 0 3.14-1.87 3.83-3.65 4.04.29.25.54.75.54 1.52 0 1.1-.01 1.98-.01 2.25 0 .22.15.48.55.4A8.13 8.13 0 0 0 16 8.2C16 3.67 12.42 0 8 0Z"/>',
  gitlab:
    '<path fill="currentColor" d="M8 15.35 10.62 7.3H5.38L8 15.35Zm0 0L1.88 7.3h3.5L8 15.35Zm0 0 6.12-8.05h-3.5L8 15.35ZM1.88 7.3.8 3.98c-.1-.31.01-.65.28-.84.27-.2.63-.18.88.03L5.38 7.3h-3.5Zm12.24 0 1.08-3.32c.1-.31-.01-.65-.28-.84a.78.78 0 0 0-.88.03L10.62 7.3h3.5ZM5.38 7.3 6.56 3.7h2.88l1.18 3.6H5.38Z"/>',
  x:
    '<path fill="currentColor" d="M9.52 6.77 15.5 0h-1.42L8.89 5.88 4.74 0H0l6.27 8.9L0 16h1.42l5.48-6.21L11.26 16H16L9.52 6.77Zm-1.94 2.2-.64-.89L1.89 1.04h2.17l4.08 5.68.63.89 5.31 7.4h-2.17L7.58 8.97Z"/>',
  mastodon:
    '<path fill="currentColor" d="M15.1 3.7c-.24-1.75-1.76-3.12-3.6-3.38C10.57.19 9.77.16 8 .16s-2.57.03-3.5.16C2.66.58 1.14 1.95.9 3.7.79 4.55.76 5.38.77 6.24c.03 2.48.45 4.92 2.72 5.53 1.05.28 1.96.34 2.69.3v1.9c-1.02.05-2.03-.04-3.05-.27 1.16 1.52 2.86 2.24 4.98 2.28 4.28.08 5.41-2.82 5.41-2.82l-.12-2.67s-1.48.94-3.95.82c-2.45-.12-2.52-1.51-2.52-1.51v-.95c.48.12.99.18 1.54.18 2.97 0 5.47-.73 5.83-2.85.33-1.92.27-3.14.08-4.48ZM5.12 6.52H3.78V4.04c0-2.62 3.38-2.72 4.22-.57.84-2.15 4.22-2.05 4.22.57v2.48h-1.34V4.11c0-1.36-1.72-1.41-1.72.19v1.32H6.84V4.3c0-1.6-1.72-1.55-1.72-.19v2.41Z"/>',
  bluesky:
    '<path fill="currentColor" d="M3.35 1.2C5.24 2.61 7.28 5.48 8 7.02c.72-1.54 2.76-4.41 4.65-5.82 1.36-1.02 3.55-1.81 3.55.7 0 .5-.29 4.2-.46 4.8-.59 2.08-2.74 2.61-4.65 2.29 3.34.56 4.19 2.43 2.35 4.29-3.5 3.54-5.03-.89-5.42-2.02L8 11.2l-.02.06c-.39 1.13-1.92 5.56-5.42 2.02C.72 11.42 1.57 9.55 4.91 8.99 3 9.31.85 8.78.26 6.7.09 6.1-.2 2.4-.2 1.9c0-2.51 2.19-1.72 3.55-.7Z"/>',
  discord:
    '<path fill="currentColor" d="M13.54 2.4A13.2 13.2 0 0 0 10.28 1l-.16.31c1.13.34 1.66.83 1.66.83A10.87 10.87 0 0 0 8 1.36c-1.29 0-2.56.27-3.78.78 0 0 .53-.49 1.66-.83L5.72 1c-1.15.2-2.24.67-3.26 1.4C.39 5.48-.17 8.48.11 11.44c1.38 1.03 2.71 1.65 4.01 2.06l.5-.82a6.43 6.43 0 0 1-1.26-.62l.3-.23c2.43 1.14 5.07 1.14 7.47 0l.31.23c-.39.24-.8.45-1.27.62l.5.82c1.31-.41 2.64-1.03 4.02-2.06.33-3.43-.56-6.4-1.15-9.04ZM5.35 9.68c-.78 0-1.42-.72-1.42-1.61 0-.9.63-1.62 1.42-1.62.8 0 1.44.73 1.42 1.62 0 .89-.63 1.61-1.42 1.61Zm5.3 0c-.79 0-1.42-.72-1.42-1.61 0-.9.63-1.62 1.42-1.62.8 0 1.42.73 1.42 1.62 0 .89-.63 1.61-1.42 1.61Z"/>',
  slack:
    '<path fill="currentColor" d="M3.38 10.08a1.69 1.69 0 1 1-1.69-1.69h1.69v1.69Zm.85 0a1.69 1.69 0 1 1 3.38 0v4.23a1.69 1.69 0 1 1-3.38 0v-4.23Zm1.69-6.7a1.69 1.69 0 1 1 1.69-1.69v1.69H5.92Zm0 .85a1.69 1.69 0 1 1 0 3.38H1.69a1.69 1.69 0 1 1 0-3.38h4.23Zm6.7 1.69a1.69 1.69 0 1 1 1.69 1.69h-1.69V5.92Zm-.85 0a1.69 1.69 0 1 1-3.38 0V1.69a1.69 1.69 0 1 1 3.38 0v4.23Zm-1.69 6.7a1.69 1.69 0 1 1-1.69 1.69v-1.69h1.69Zm0-.85a1.69 1.69 0 1 1 0-3.38h4.23a1.69 1.69 0 1 1 0 3.38h-4.23Z"/>',
  npm:
    '<path fill="currentColor" d="M0 3h16v10H8V5H6v8H0V3Zm2 2v6h2V5H2Zm8 0v6h4V5h-4Zm2 1h1v4h-1V6Z"/>',
  linkedin:
    '<path fill="currentColor" d="M3.58 15.5H.26V5.3h3.32v10.2ZM1.92 3.9A1.92 1.92 0 1 1 1.92.06a1.92 1.92 0 0 1 0 3.84ZM15.74 15.5h-3.31v-4.96c0-1.18-.02-2.7-1.65-2.7-1.65 0-1.9 1.29-1.9 2.62v5.04H5.57V5.3h3.18v1.39h.05c.44-.84 1.52-1.72 3.13-1.72 3.35 0 3.97 2.2 3.97 5.07v5.46h-.16Z"/>',
  youtube:
    '<path fill="currentColor" d="M15.67 4.2a2 2 0 0 0-1.41-1.42C13.01 2.45 8 2.45 8 2.45s-5.01 0-6.26.33A2 2 0 0 0 .33 4.2 20.83 20.83 0 0 0 0 8a20.83 20.83 0 0 0 .33 3.8 2 2 0 0 0 1.41 1.42c1.25.33 6.26.33 6.26.33s5.01 0 6.26-.33a2 2 0 0 0 1.41-1.42A20.83 20.83 0 0 0 16 8a20.83 20.83 0 0 0-.33-3.8ZM6.4 10.34V5.66L10.56 8 6.4 10.34Z"/>',
  rss:
    '<path fill="currentColor" d="M2.18 11.64a2.18 2.18 0 1 1 0 4.36 2.18 2.18 0 0 1 0-4.36ZM0 5.45c5.83 0 10.55 4.72 10.55 10.55H7.45A7.45 7.45 0 0 0 0 8.55v-3.1ZM0 0c8.84 0 16 7.16 16 16h-3.1C12.9 8.87 7.13 3.1 0 3.1V0Z"/>',
}

function builtInIcon(name: string): string | undefined {
  const path = SOCIAL_ICONS[name]
  return path === undefined
    ? undefined
    : `<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" width="16" height="16">${path}</svg>`
}

/**
 * A custom icon is author-supplied markup inlined into every page, so it goes
 * through the engine's SVG tokenizer rather than a pattern match. Regex
 * denylists for SVG get bypassed - by entity encoding, by SMIL, by xlink - and
 * this project has already shipped one such bypass. Rejecting the sanitizer's
 * own verdict is the honest failure: the icon renders exactly as sanitized or
 * the build stops and says which link is at fault.
 */
function safeCustomSvg(svg: string, link: string): string {
  const result = sanitizeSvg(svg)
  if (!result.ok) {
    throw new BuildError(`themeConfig.socialLinks: custom svg for ${link} is not a well-formed <svg>`)
  }
  return result.svg
}

export function socialLinkHtml(link: SocialLink): string {
  const body =
    typeof link.icon === 'string'
      ? builtInIcon(link.icon.toLowerCase()) ?? `<span>${escapeText(link.icon)}</span>`
      : safeCustomSvg(link.icon.svg, link.link)
  const label = typeof link.icon === 'string' ? link.icon : link.link
  return `<a class="social-link" href="${escapeAttr(link.link)}" aria-label="${escapeAttr(
    label,
  )}">${body}</a>`
}

export function socialLinksHtml(links: SocialLink[]): string {
  if (links.length === 0) return ''
  return `<div class="social-links">${links.map(socialLinkHtml).join('')}</div>`
}

function themeToggleHtml(): string {
  return `<button class="theme-toggle" type="button" data-theme-toggle aria-label="Switch to dark theme"><span aria-hidden="true">Theme</span></button>`
}

function searchHtml(ctx: LayoutContext): string {
  if (ctx.config.search === false) return ''
  return `<div class="site-search" data-search-root data-search-index="${escapeAttr(
    withBase(ctx.config.base, `/assets/${ctx.config.search.filename}`),
  )}" hidden><label class="site-search__label" for="site-search-input">Search</label><input class="site-search__input" id="site-search-input" type="search" placeholder="Search" autocomplete="off" spellcheck="false" data-search-input><div class="site-search__status" aria-live="polite" data-search-status></div><div class="site-search__panel" data-search-panel hidden><ul class="site-search__results" data-search-results></ul></div></div>`
}

function drawerButtonHtml(kind: 'nav' | 'sidebar', label: string, hasTarget: boolean): string {
  if (!hasTarget) return ''
  const controls = kind === 'nav' ? 'site-nav-drawer' : 'site-sidebar-drawer'
  return `<button class="drawer-toggle drawer-toggle--${kind}" type="button" data-drawer-toggle="${kind}" aria-label="${escapeAttr(
    label,
  )}" aria-controls="${controls}" aria-expanded="false"><span aria-hidden="true"></span></button>`
}

function logoSrc(src: string, base: string): string {
  return src.startsWith('/') ? withBase(base, src) : src
}

function logoHtml(logo: ThemeLogo | undefined, base: string, fallbackAlt: string): string {
  if (logo === undefined) return ''
  if (typeof logo === 'string') {
    return `<img class="site-logo site-logo--single" src="${escapeAttr(logoSrc(logo, base))}" alt="${escapeAttr(
      fallbackAlt,
    )}">`
  }
  const alt = logo.alt ?? fallbackAlt
  return `<span class="site-logo-pair"><img class="site-logo site-logo--light" src="${escapeAttr(
    logoSrc(logo.light, base),
  )}" alt="${escapeAttr(alt)}"><img class="site-logo site-logo--dark" src="${escapeAttr(
    logoSrc(logo.dark, base),
  )}" alt="${escapeAttr(alt)}"></span>`
}

/**
 * `sidebarDrawer` is what the caller actually rendered, not what the config
 * would allow: the home and page layouts drop the sidebar, and a toggle whose
 * aria-controls target does not exist is a button that does nothing.
 */
export function headerHtml(ctx: LayoutContext, sidebarDrawer = ctx.sidebar.length > 0): string {
  const title = ctx.config.themeConfig.siteTitle ?? ctx.config.title
  const titleText = title === false ? '' : `<span class="site-title__text">${escapeText(title)}</span>`
  return `<header class="site-header">${drawerButtonHtml('sidebar', 'Open documentation navigation', sidebarDrawer)}<a class="site-title" href="${escapeAttr(
    withBase(ctx.config.base, '/'),
  )}">${logoHtml(ctx.config.themeConfig.logo, ctx.config.base, ctx.config.title)}${titleText}</a><div class="site-header__right">${drawerButtonHtml(
    'nav',
    'Open primary navigation',
    ctx.config.themeConfig.nav.length > 0,
  )}${headerNavHtml(
    ctx.config.themeConfig.nav,
    ctx.config.base,
    ctx.rendered.page.route,
  )}${searchHtml(ctx)}${socialLinksHtml(ctx.config.themeConfig.socialLinks)}${themeToggleHtml()}</div></header>`
}

function sidebarContainsCurrent(items: SidebarItem[], current: string): boolean {
  for (const item of items) {
    if (item.link === current || sidebarContainsCurrent(item.items ?? [], current)) return true
  }
  return false
}

function sidebarItemHtml(item: SidebarItem, base: string, current: string, depth: number): string {
  const className = `sidebar__item sidebar__item--l${depth}`
  const body =
    item.link === undefined
      ? `<span class="sidebar__text">${escapeText(item.text)}</span>`
      : `<a href="${escapeAttr(withBase(base, item.link))}"${
          item.link === current ? ' aria-current="page"' : ''
        }>${escapeText(item.text)}</a>`
  const children =
    item.items === undefined || item.items.length === 0
      ? ''
      : `<ul>${item.items.map((child) => sidebarItemHtml(child, base, current, depth + 1)).join('')}</ul>`
  return `<li class="${className}">${body}${children}</li>`
}

export function sidebarHtml(groups: SidebarGroup[], base: string, current: string): string {
  if (groups.length === 0) return ''
  const items = groups
    .map((group) => {
      const links = group.items.map((item) => sidebarItemHtml(item, base, current, 1)).join('')
      const title = escapeText(group.text)
      if (group.collapsed === undefined) {
        return `<li class="sidebar-group"><span class="sidebar-group__title">${title}</span><ul>${links}</ul></li>`
      }
      const open = group.collapsed === false || sidebarContainsCurrent(group.items, current) ? ' open' : ''
      return `<li><details class="sidebar-group"${open}><summary class="sidebar-group__title">${title}</summary><ul>${links}</ul></details></li>`
    })
    .join('')
  return `<nav class="sidebar" id="site-sidebar-drawer" aria-label="Documentation" data-mobile-drawer="sidebar"><ul>${items}</ul></nav>`
}

export function outlineHtml(ctx: LayoutContext): string {
  if (ctx.rendered.outline.length === 0) return ''
  const items = ctx.rendered.outline
    .map(
      (entry) =>
        `<li class="outline__item outline__item--l${entry.level}"><a href="#${escapeAttr(
          entry.slug,
        )}">${escapeText(entry.title)}</a></li>`,
    )
    .join('')
  return `<nav class="outline" aria-label="On this page"><ul>${items}</ul></nav>`
}

export function footerNav(ctx: LayoutContext): string {
  const { base } = ctx.config
  const link = (item: FlatLink | undefined, rel: string): string =>
    item === undefined
      ? ''
      : `<a class="page-nav__${rel}" rel="${rel}" href="${escapeAttr(
          withBase(base, item.link),
        )}"><span class="page-nav__eyebrow">${rel === 'prev' ? 'Previous' : 'Next'}</span><span class="page-nav__title">${escapeText(
          item.text,
        )}</span></a>`
  const prev = link(ctx.prev, 'prev')
  const next = link(ctx.next, 'next')
  return prev === '' && next === ''
    ? ''
    : `<nav class="page-nav" aria-label="Page navigation">${prev}${next}</nav>`
}

export function lastUpdatedHtml(ctx: LayoutContext): string {
  if (ctx.config.themeConfig.lastUpdated !== true || ctx.lastUpdated === undefined) return ''
  const iso = ctx.lastUpdated.toISOString()
  const text = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(ctx.lastUpdated)
  return `<p class="last-updated">Last updated <time datetime="${escapeAttr(iso)}">${escapeText(
    text,
  )}</time></p>`
}

export function siteFooter(ctx: LayoutContext): string {
  const footer = ctx.config.themeConfig.footer
  if (footer === undefined) return ''
  return `<footer class="site-footer"><p class="site-footer__message">${escapeText(
    footer.message,
  )}</p><p class="site-footer__copyright">${escapeText(footer.copyright)}</p></footer>`
}

export function pageDescription(ctx: LayoutContext): string | undefined {
  return typeof ctx.rendered.page.frontmatter.description === 'string'
    ? ctx.rendered.page.frontmatter.description
    : ctx.config.description
}

export function documentTitle(ctx: LayoutContext): string {
  const pageTitle = ctx.rendered.searchDoc.title
  return pageTitle === ctx.config.title ? pageTitle : `${pageTitle} | ${ctx.config.title}`
}

function absolutePageUrl(ctx: LayoutContext): string | undefined {
  const hostname = ctx.config.hostname?.replace(/\/+$/, '')
  if (hostname === undefined || hostname === '') return undefined
  return `${hostname}${withBase(ctx.config.base, ctx.rendered.page.route)}`
}

function hasCanonical(head: HeadTag[]): boolean {
  return head.some(([tag, attrs]) => tag.toLowerCase() === 'link' && attrs.rel?.toLowerCase() === 'canonical')
}

function hasOgUrl(head: HeadTag[]): boolean {
  return head.some(
    ([tag, attrs]) => tag.toLowerCase() === 'meta' && attrs.property?.toLowerCase() === 'og:url',
  )
}

function pageUrlHead(ctx: LayoutContext): HeadTag[] {
  const url = absolutePageUrl(ctx)
  if (url === undefined) return []
  const tags: HeadTag[] = []
  if (!hasCanonical(ctx.config.head)) tags.push(['link', { rel: 'canonical', href: url }])
  if (!hasOgUrl(ctx.config.head)) tags.push(['meta', { property: 'og:url', content: url }])
  return tags
}

function themeToggleScript(): string {
  return `    <script>(()=>{const b=document.querySelector('[data-theme-toggle]');if(!b)return;const d=document.documentElement,k='carve-press-theme',m=matchMedia('(prefers-color-scheme: dark)'),p=()=>m.matches?'dark':'light',c=()=>d.dataset.theme||p(),u=()=>{const n=c()==='dark'?'light':'dark';b.setAttribute('aria-label','Switch to '+n+' theme');b.dataset.themeToggleState=c()};u();b.addEventListener('click',()=>{const n=c()==='dark'?'light':'dark';d.dataset.theme=n;try{localStorage.setItem(k,n)}catch{}u()});m.addEventListener('change',()=>{try{if(localStorage.getItem(k))return}catch{}u()})})()</script>`
}

function searchScript(ctx: LayoutContext): string {
  return ctx.config.search === false
    ? ''
    : `\n    <script src="${escapeAttr(withBase(ctx.config.base, '/assets/search.js'))}" type="module"></script>`
}

function playgroundScript(ctx: LayoutContext): string {
  return ctx.rendered.html.includes('<carve-playground')
    ? `\n    <script src="${escapeAttr(withBase(ctx.config.base, '/assets/playground.js'))}" type="module"></script>`
    : ''
}

function tableScrollScript(ctx: LayoutContext): string {
  return `\n    <script src="${escapeAttr(withBase(ctx.config.base, '/assets/table-scroll.js'))}" defer></script>`
}

function codeCopyScript(ctx: LayoutContext): string {
  return `\n    <script src="${escapeAttr(withBase(ctx.config.base, '/assets/code-copy.js'))}" defer></script>`
}

function outlineScript(ctx: LayoutContext): string {
  return `\n    <script src="${escapeAttr(withBase(ctx.config.base, '/assets/outline.js'))}" defer></script>`
}

function navScript(ctx: LayoutContext): string {
  return `\n    <script src="${escapeAttr(withBase(ctx.config.base, '/assets/nav.js'))}" defer></script>`
}

export function editLink(ctx: LayoutContext): string {
  const edit = ctx.config.themeConfig.editLink
  if (edit === undefined) return ''
  const href = edit.pattern.replace(':path', ctx.rendered.page.relPath)
  return `<a class="edit-link" href="${escapeAttr(href)}">${escapeText(edit.text)}</a>`
}

export const docLayout: Layout = (ctx) => {
  const body = `    ${headerHtml(ctx)}
    <div class="layout">
      ${sidebarHtml(ctx.sidebar, ctx.config.base, ctx.rendered.page.route)}
      <main class="content">
${ctx.rendered.html}
        ${editLink(ctx)}
        ${lastUpdatedHtml(ctx)}
        ${footerNav(ctx)}
      </main>
      ${outlineHtml(ctx)}
    </div>
    ${siteFooter(ctx)}
    <div class="drawer-scrim" data-drawer-scrim hidden></div>
${themeToggleScript()}${searchScript(ctx)}${navScript(ctx)}${tableScrollScript(ctx)}${codeCopyScript(ctx)}${outlineScript(ctx)}${playgroundScript(ctx)}`

  return htmlDocument({
    lang: 'en-US',
    title: documentTitle(ctx),
    description: pageDescription(ctx),
    head: ctx.config.head,
    extraHead: pageUrlHead(ctx),
    base: ctx.config.base,
    body,
  })
}

export const pageLayout: Layout = (ctx) => {
  const body = `    ${headerHtml(ctx, false)}
    <main class="page-layout content">
${ctx.rendered.html}
        ${editLink(ctx)}
        ${lastUpdatedHtml(ctx)}
      </main>
    ${siteFooter(ctx)}
    <div class="drawer-scrim" data-drawer-scrim hidden></div>
${themeToggleScript()}${searchScript(ctx)}${navScript(ctx)}${tableScrollScript(ctx)}${codeCopyScript(ctx)}${playgroundScript(ctx)}`

  return htmlDocument({
    lang: 'en-US',
    title: documentTitle(ctx),
    description: pageDescription(ctx),
    head: ctx.config.head,
    extraHead: pageUrlHead(ctx),
    base: ctx.config.base,
    body,
  })
}

function actionHtml(action: HomeHeroAction, base: string): string {
  const text = stringValue(action.text)
  const link = stringValue(action.link)
  if (text === undefined || link === undefined) return ''
  const href = link.startsWith('/') ? withBase(base, link) : link
  const theme = action.theme === 'brand' ? 'brand' : 'alt'
  return `<a class="home-hero__action home-hero__action--${theme}" href="${escapeAttr(
    href,
  )}">${escapeText(text)}</a>`
}

function heroHtml(ctx: LayoutContext): string {
  const hero = objectValue(ctx.rendered.page.frontmatter.hero) as HomeHero | undefined
  if (hero === undefined) return ''
  const name = stringValue(hero.name)
  const text = stringValue(hero.text)
  const tagline = stringValue(hero.tagline)
  const image = objectValue(hero.image) as HomeHeroImage | undefined
  const imageSrc = stringValue(image?.src)
  const imageAlt = stringValue(image?.alt) ?? ''
  const actions = Array.isArray(hero.actions)
    ? hero.actions
        .map((action) => homeHeroActionValue(action))
        .filter((action): action is HomeHeroAction => action !== undefined)
    : []
  const actionList = actions.map((action) => actionHtml(action, ctx.config.base)).join('')
  const media =
    imageSrc === undefined
      ? ''
      : `<div class="home-hero__media"><img src="${escapeAttr(
          imageSrc.startsWith('/') ? withBase(ctx.config.base, imageSrc) : imageSrc,
        )}" alt="${escapeAttr(imageAlt)}"></div>`
  const content = [
    name === undefined ? '' : `<p class="home-hero__name">${escapeText(name)}</p>`,
    text === undefined ? '' : `<p class="home-hero__text">${escapeText(text)}</p>`,
    tagline === undefined ? '' : `<p class="home-hero__tagline">${escapeText(tagline)}</p>`,
    actionList === '' ? '' : `<div class="home-hero__actions">${actionList}</div>`,
  ].join('')
  return `<section class="home-hero">${media}<div class="home-hero__content">${content}</div></section>`
}

function featuresHtml(ctx: LayoutContext): string {
  const features = Array.isArray(ctx.rendered.page.frontmatter.features)
    ? ctx.rendered.page.frontmatter.features
        .map((feature) => homeFeatureValue(feature))
        .filter((feature): feature is HomeFeature => feature !== undefined)
    : []
  const items = features
    .map((feature) => {
      const title = stringValue(feature.title)
      const details = stringValue(feature.details)
      if (title === undefined && details === undefined) return ''
      return `<li class="home-feature">${
        title === undefined ? '' : `<h2>${escapeText(title)}</h2>`
      }${details === undefined ? '' : `<p>${escapeText(details)}</p>`}</li>`
    })
    .join('')
  return items === '' ? '' : `<section class="home-features"><ul>${items}</ul></section>`
}

export const homeLayout: Layout = (ctx) => {
  const renderedBody =
    ctx.rendered.html.trim() === '' ? '' : `<div class="home-body content">${ctx.rendered.html}</div>`
  const body = `    ${headerHtml(ctx, false)}
    <main class="home-layout">
      ${heroHtml(ctx)}
      ${featuresHtml(ctx)}
      ${renderedBody}
    </main>
    ${siteFooter(ctx)}
    <div class="drawer-scrim" data-drawer-scrim hidden></div>
${themeToggleScript()}${searchScript(ctx)}${navScript(ctx)}${tableScrollScript(ctx)}${codeCopyScript(ctx)}${playgroundScript(ctx)}`

  return htmlDocument({
    lang: 'en-US',
    title: documentTitle(ctx),
    description: pageDescription(ctx),
    head: ctx.config.head,
    base: ctx.config.base,
    body,
  })
}

export const LAYOUTS: Record<string, Layout> = { doc: docLayout, home: homeLayout, page: pageLayout }
