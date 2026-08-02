import type { RenderedPage } from '../render/page.js'

export function isDraft(page: RenderedPage): boolean {
  return page.page.frontmatter.draft === true
}

export function publicRenderedPages(rendered: RenderedPage[]): RenderedPage[] {
  return rendered.filter((page) => !isDraft(page))
}

