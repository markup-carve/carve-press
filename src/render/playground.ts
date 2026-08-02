import { carveToHtml, type Attrs, type CarveExtension } from '@markup-carve/carve'

interface CodeBlockNode {
  type: string
  lang?: string
  content: string
}

const FALLBACK_SAMPLE = ['/italic/', '*bold*', '_underline_', '~strike~', '=highlight='].join('\n')

function withBaseClasses(attrs: Attrs | undefined, ...baseClasses: string[]): Attrs {
  const classes = [...baseClasses, ...(attrs?.classes ?? [])]
  const order = attrs?.order === undefined ? undefined : attrs.order.includes('.class') ? attrs.order : ['.class', ...attrs.order]
  return { ...attrs, classes, ...(order === undefined ? {} : { order }) }
}

function syntheticCarveBlock(content: string): CodeBlockNode {
  return { type: 'code_block', lang: 'carve', content }
}

function renderSourceTemplate(source: string, escapeHtml: (value: string) => string): string {
  return `<template data-carve-playground-source>${escapeHtml(source)}</template>`
}

export function playgroundExtension(): CarveExtension {
  let counter = 0

  return {
    name: 'carve-press-playground',
    beforeRender(doc) {
      counter = 0
      return doc
    },
    blockRenderers: {
      admonition(node, ctx) {
        const adm = node as {
          kind?: string
          children?: unknown[]
        }
        if (adm.kind !== 'playground') return undefined

        const children = (adm.children ?? []) as CodeBlockNode[]
        const carve = children.find((child) => child.type === 'code_block' && child.lang === 'carve')
        const source = carve?.content ?? FALLBACK_SAMPLE
        const sourceBlock = carve ?? syntheticCarveBlock(source)
        const rendered = carveToHtml(source)
        const group = `playground-${++counter}`
        const renderedId = ctx.uniqueId(`${group}-rendered`)
        const htmlId = ctx.uniqueId(`${group}-html`)
        const attrs = ctx.renderAttrs(withBaseClasses(node.attrs, 'carve-playground'))

        const sourcePane = `<div class="carve-playground__source" data-carve-playground-source-view>${ctx.renderChildren(
          [sourceBlock] as never,
          ctx.level + 1,
        )}</div>`
        const output = [
          `<input type="radio" name="${group}" id="${renderedId}" class="carve-playground__radio" checked>`,
          `<label for="${renderedId}" class="carve-playground__label">Rendered</label>`,
          `<input type="radio" name="${group}" id="${htmlId}" class="carve-playground__radio">`,
          `<label for="${htmlId}" class="carve-playground__label">HTML</label>`,
          `<div class="carve-playground__pane carve-playground__live" data-carve-playground-rendered>${rendered}</div>`,
          `<div class="carve-playground__pane"><pre><code data-carve-playground-html>${ctx.escapeHtml(rendered)}\n</code></pre></div>`,
        ].join('')

        return `<carve-playground${attrs}>${renderSourceTemplate(
          source,
          ctx.escapeHtml,
        )}${sourcePane}<div class="carve-playground__output">${output}</div></carve-playground>`
      },
    },
  }
}
