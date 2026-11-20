import {
  encodeTree,
  parse,
  render,
  type Attrs,
  type BlockExtensionNode,
  type CodeBlockNode,
  type ExtensionClaim,
  type ExtensionDefinition,
  type ExtensionRenderHost,
  type ExtensionRenderer,
  type InlineExtensionNode,
} from '@markup-carve/carve'
import { fenceContent } from './fence.js'
import type { PressExtension } from './press-extension.js'

export interface PlaygroundAssetUrls {
  wasm?: string
  mermaid?: string
  chart?: string
}

const PLAYGROUND = 'carve-press.playground'
const FALLBACK_SAMPLE = ['/italic/', '*bold*', '{_underline_}', '{~strike~}', '{=highlight=}'].join('\n')

function withPlaygroundAttrs(attrs: Attrs | undefined, assets: PlaygroundAssetUrls): Attrs {
  const configured: Array<[string, string | undefined]> = [
    ['data-playground-wasm', assets.wasm],
    ['data-playground-mermaid', assets.mermaid],
    ['data-playground-chart', assets.chart],
  ]
  const keyValues: [string, string][] = (attrs?.keyValues ?? []).map(([key, value]) => [
    key,
    configured.find(([name, url]) => name === key && url !== undefined)?.[1] ?? value,
  ])
  for (const [key, value] of configured) {
    if (value !== undefined && !keyValues.some(([name]) => name === key)) keyValues.push([key, value])
  }
  return {
    ...attrs,
    classes: ['carve-playground', ...(attrs?.classes ?? [])],
    ...(keyValues.length === 0 ? {} : { keyValues }),
  }
}

function isCarveBlock(node: { type: string }): node is CodeBlockNode {
  return node.type === 'code_block' && (node as CodeBlockNode).syntax === 'carve'
}

// The engine attaches the authored attrs itself, minus the `playground` name class.
function playgroundTransform(claim: ExtensionClaim): BlockExtensionNode | null {
  if (claim.form !== 'div') return null
  const carve = claim.body.find(isCarveBlock)
  return {
    type: 'block_extension',
    name: PLAYGROUND,
    version: '1',
    children: [],
    slots: { source: carve === undefined ? [] : [carve] },
    fallback: structuredClone(claim.body),
  }
}

const playgroundDefinition: ExtensionDefinition = {
  name: PLAYGROUND,
  version: '1',
  matcher: { form: 'div', name: 'playground' },
  props: {},
  children: 'none',
  slots: { source: { kind: 'block', optional: true } },
  transform: playgroundTransform,
}

function renderPlayground(
  node: BlockExtensionNode | InlineExtensionNode,
  host: ExtensionRenderHost,
  assets: PlaygroundAssetUrls,
): string {
  if (node.type !== 'block_extension') return ''
  const carve = node.slots?.['source']?.find(isCarveBlock)
  const source = carve === undefined ? FALLBACK_SAMPLE : fenceContent(carve.value)
  const sourceBlock: CodeBlockNode = carve ?? { type: 'code_block', value: `${source}\n`, syntax: 'carve' }
  const rendered = render(source)
  const ast = JSON.stringify(JSON.parse(encodeTree(parse(source))), null, 2)
  const group = host.nextId('playground', ['-rendered', '-html', '-ast'])
  const renderedId = `${group}-rendered`
  const htmlId = `${group}-html`
  const astId = `${group}-ast`
  const attrs = host.attributes({ ...node, attrs: withPlaygroundAttrs(node.attrs, assets) }, { block: true })

  const sourcePane = `<div class="carve-playground__source" data-carve-playground-source-view>${host.blocks(
    [sourceBlock],
    host.blockDepth + 1,
  )}</div>`
  const output = [
    `<input type="radio" name="${group}" id="${renderedId}" class="carve-playground__radio" checked>`,
    `<label for="${renderedId}" class="carve-playground__label">Rendered</label>`,
    `<input type="radio" name="${group}" id="${htmlId}" class="carve-playground__radio">`,
    `<label for="${htmlId}" class="carve-playground__label">HTML</label>`,
    `<input type="radio" name="${group}" id="${astId}" class="carve-playground__radio">`,
    `<label for="${astId}" class="carve-playground__label">AST</label>`,
    `<div class="carve-playground__pane carve-playground__live" data-carve-playground-rendered>${rendered}</div>`,
    `<div class="carve-playground__pane carve-playground__pane--html"><pre><code data-carve-playground-html>${host.escapeText(rendered)}\n</code></pre></div>`,
    `<div class="carve-playground__pane carve-playground__pane--ast"><pre><code data-carve-playground-ast>${host.escapeText(ast)}\n</code></pre></div>`,
  ].join('')

  return `<carve-playground${attrs}><template data-carve-playground-source>${host.escapeText(
    source,
  )}</template>${sourcePane}<div class="carve-playground__output">${output}</div></carve-playground>`
}

export function playgroundExtension(assets: PlaygroundAssetUrls = {}): PressExtension {
  const renderer: ExtensionRenderer = {
    version: '1',
    render: (node, host) => renderPlayground(node, host, assets),
  }
  return { name: 'carve-press-playground', extensions: [playgroundDefinition], renderers: { [PLAYGROUND]: renderer } }
}
