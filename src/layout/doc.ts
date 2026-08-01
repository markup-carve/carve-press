import type { CarvePressConfig, SidebarGroup } from '../config.js'
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

function editLink(ctx: LayoutContext): string {
  const edit = ctx.config.themeConfig.editLink
  if (edit === undefined) return ''
  const href = edit.pattern.replace(':path', ctx.rendered.page.relPath)
  return `<a class="edit-link" href="${escapeAttr(href)}">${escapeText(edit.text)}</a>`
}

export const docLayout: Layout = (ctx) => {
  const pageTitle = ctx.rendered.searchDoc.title
  const description =
    typeof ctx.rendered.page.frontmatter.description === 'string'
      ? ctx.rendered.page.frontmatter.description
      : ctx.config.description

  const body = `    <div class="layout">
      ${sidebarHtml(ctx.sidebar, ctx.config.base, ctx.rendered.page.route)}
      <main class="content">
${ctx.rendered.html}
        ${editLink(ctx)}
        ${footerNav(ctx)}
      </main>
      ${outlineHtml(ctx)}
    </div>`

  return htmlDocument({
    lang: 'en-US',
    title: pageTitle === ctx.config.title ? pageTitle : `${pageTitle} | ${ctx.config.title}`,
    description,
    head: ctx.config.head,
    base: ctx.config.base,
    body,
  })
}

export const LAYOUTS: Record<string, Layout> = { doc: docLayout }
