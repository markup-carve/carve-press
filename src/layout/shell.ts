import type { HeadTag } from '../config.js'

export function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Join a normalized base with a route, avoiding a doubled slash. */
export function withBase(base: string, link: string): string {
  return `${base.replace(/\/$/, '')}${link}`
}

function renderHead(tags: HeadTag[]): string {
  return tags
    .map(([tag, attrs]) => {
      const rendered = Object.entries(attrs)
        .map(([k, v]) => ` ${k}="${escapeAttr(v)}"`)
        .join('')
      return `<${tag}${rendered}>`
    })
    .join('\n    ')
}

function themeBootstrapScript(): string {
  return `<script>(()=>{try{const t=localStorage.getItem('carve-press-theme');if(t==='dark'||t==='light')document.documentElement.dataset.theme=t}catch{}})()</script>`
}

export interface DocumentOptions {
  lang: string
  title: string
  description?: string
  head: HeadTag[]
  extraHead?: HeadTag[]
  base: string
  /** Emitted stylesheet URL; the caller resolves it through the asset manifest. */
  stylesheet?: string
  body: string
}

export function htmlDocument(opts: DocumentOptions): string {
  const description =
    opts.description === undefined
      ? ''
      : `\n    <meta name="description" content="${escapeAttr(opts.description)}">`
  return `<!doctype html>
<html lang="${escapeAttr(opts.lang)}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeText(opts.title)}</title>${description}
    ${themeBootstrapScript()}
    <link rel="stylesheet" href="${escapeAttr(opts.stylesheet ?? withBase(opts.base, '/assets/style.css'))}">
    ${renderHead([...opts.head, ...(opts.extraHead ?? [])])}
  </head>
  <body>
${opts.body}
  </body>
</html>
`
}
