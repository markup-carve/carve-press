import type { CarvePressConfig, NavItem, SidebarGroup, SocialLink } from '../config.js'
import type { RenderedPage } from '../render/page.js'
import type { FlatLink } from '../nav.js'
import { htmlDocument, escapeAttr, escapeText, withBase } from './shell.js'

export { htmlDocument }

export interface LayoutContext {
  config: CarvePressConfig
  rendered: RenderedPage
  sidebar: SidebarGroup[]
  prev?: FlatLink
  next?: FlatLink
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

function headerNavHtml(items: NavItem[], base: string, current: string): string {
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
  return `<nav class="site-nav" aria-label="Primary"><ul>${links}</ul></nav>`
}

function githubIcon(): string {
  return `<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" width="16" height="16"><path fill="currentColor" d="M8 0C3.58 0 0 3.67 0 8.2c0 3.63 2.29 6.7 5.47 7.79.4.07.55-.18.55-.4 0-.2-.01-.86-.01-1.56-2.01.38-2.53-.5-2.69-.96-.09-.23-.48-.96-.82-1.15-.28-.16-.68-.55-.01-.56.63-.01 1.08.59 1.23.83.72 1.24 1.87.89 2.33.68.07-.53.28-.89.51-1.09-1.78-.21-3.64-.91-3.64-4.04 0-.89.31-1.62.82-2.19-.08-.21-.36-1.04.08-2.16 0 0 .67-.22 2.2.84A7.42 7.42 0 0 1 8 3.96c.68 0 1.36.09 2 .27 1.52-1.06 2.19-.84 2.19-.84.44 1.12.16 1.95.08 2.16.51.57.82 1.3.82 2.19 0 3.14-1.87 3.83-3.65 4.04.29.25.54.75.54 1.52 0 1.1-.01 1.98-.01 2.25 0 .22.15.48.55.4A8.13 8.13 0 0 0 16 8.2C16 3.67 12.42 0 8 0Z"/></svg>`
}

function socialLinkHtml(link: SocialLink): string {
  const icon = link.icon.toLowerCase()
  const body = icon === 'github' ? githubIcon() : `<span>${escapeText(link.icon)}</span>`
  return `<a class="social-link" href="${escapeAttr(link.link)}" aria-label="${escapeAttr(
    link.icon,
  )}">${body}</a>`
}

function socialLinksHtml(links: SocialLink[]): string {
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

function headerHtml(ctx: LayoutContext): string {
  return `<header class="site-header"><a class="site-title" href="${escapeAttr(
    withBase(ctx.config.base, '/'),
  )}">${escapeText(ctx.config.title)}</a><div class="site-header__right">${headerNavHtml(
    ctx.config.themeConfig.nav,
    ctx.config.base,
    ctx.rendered.page.route,
  )}${searchHtml(ctx)}${socialLinksHtml(ctx.config.themeConfig.socialLinks)}${themeToggleHtml()}</div></header>`
}

function sidebarHtml(groups: SidebarGroup[], base: string, current: string): string {
  if (groups.length === 0) return ''
  const items = groups
    .map((group) => {
      const links = group.items
        .map((item) =>
          item.link === undefined
            ? `<li>${escapeText(item.text)}</li>`
            : `<li><a href="${escapeAttr(withBase(base, item.link))}"${
                item.link === current ? ' aria-current="page"' : ''
              }>${escapeText(item.text)}</a></li>`,
        )
        .join('')
      return `<li class="sidebar-group"><span class="sidebar-group__title">${escapeText(
        group.text,
      )}</span><ul>${links}</ul></li>`
    })
    .join('')
  return `<nav class="sidebar" aria-label="Documentation"><ul>${items}</ul></nav>`
}

function outlineHtml(ctx: LayoutContext): string {
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

function footerNav(ctx: LayoutContext): string {
  const { base } = ctx.config
  const link = (item: FlatLink | undefined, rel: string): string =>
    item === undefined
      ? ''
      : `<a class="page-nav__${rel}" rel="${rel}" href="${escapeAttr(
          withBase(base, item.link),
        )}">${escapeText(item.text)}</a>`
  const prev = link(ctx.prev, 'prev')
  const next = link(ctx.next, 'next')
  return prev === '' && next === '' ? '' : `<nav class="page-nav">${prev}${next}</nav>`
}

function siteFooter(ctx: LayoutContext): string {
  const footer = ctx.config.themeConfig.footer
  if (footer === undefined) return ''
  return `<footer class="site-footer"><p class="site-footer__message">${escapeText(
    footer.message,
  )}</p><p class="site-footer__copyright">${escapeText(footer.copyright)}</p></footer>`
}

function pageDescription(ctx: LayoutContext): string | undefined {
  return typeof ctx.rendered.page.frontmatter.description === 'string'
    ? ctx.rendered.page.frontmatter.description
    : ctx.config.description
}

function documentTitle(ctx: LayoutContext): string {
  const pageTitle = ctx.rendered.searchDoc.title
  return pageTitle === ctx.config.title ? pageTitle : `${pageTitle} | ${ctx.config.title}`
}

function themeToggleScript(): string {
  return `    <script>(()=>{const b=document.querySelector('[data-theme-toggle]');if(!b)return;const d=document.documentElement,k='carve-press-theme',m=matchMedia('(prefers-color-scheme: dark)'),p=()=>m.matches?'dark':'light',c=()=>d.dataset.theme||p(),u=()=>{const n=c()==='dark'?'light':'dark';b.setAttribute('aria-label','Switch to '+n+' theme');b.dataset.themeToggleState=c()};u();b.addEventListener('click',()=>{const n=c()==='dark'?'light':'dark';d.dataset.theme=n;try{localStorage.setItem(k,n)}catch{}u()});m.addEventListener('change',()=>{try{if(localStorage.getItem(k))return}catch{}u()})})()</script>`
}

function searchScript(ctx: LayoutContext): string {
  return ctx.config.search === false
    ? ''
    : `\n    <script src="${escapeAttr(withBase(ctx.config.base, '/assets/search.js'))}" defer></script>`
}

function playgroundScript(ctx: LayoutContext): string {
  return ctx.rendered.html.includes('<carve-playground')
    ? `\n    <script src="${escapeAttr(withBase(ctx.config.base, '/assets/playground.js'))}" type="module"></script>`
    : ''
}

function editLink(ctx: LayoutContext): string {
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
        ${footerNav(ctx)}
      </main>
      ${outlineHtml(ctx)}
    </div>
    ${siteFooter(ctx)}
${themeToggleScript()}${searchScript(ctx)}${playgroundScript(ctx)}`

  return htmlDocument({
    lang: 'en-US',
    title: documentTitle(ctx),
    description: pageDescription(ctx),
    head: ctx.config.head,
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
  const body = `    ${headerHtml(ctx)}
    <main class="home-layout">
      ${heroHtml(ctx)}
      ${featuresHtml(ctx)}
      ${renderedBody}
    </main>
    ${siteFooter(ctx)}
${themeToggleScript()}${searchScript(ctx)}${playgroundScript(ctx)}`

  return htmlDocument({
    lang: 'en-US',
    title: documentTitle(ctx),
    description: pageDescription(ctx),
    head: ctx.config.head,
    base: ctx.config.base,
    body,
  })
}

export const LAYOUTS: Record<string, Layout> = { doc: docLayout, home: homeLayout }
