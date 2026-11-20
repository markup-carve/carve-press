import type { BlockExtensionNode, ExtensionClaim, ExtensionRenderHost } from '@markup-carve/carve'
import type { PressExtension } from './press-extension.js'

/**
 * Claims `::: <div>` blocks as one block extension whose children are the
 * div's blocks and whose attributes are the authored ones, then renders it.
 */
export function divExtension(
  name: string,
  div: string,
  render: (node: BlockExtensionNode, host: ExtensionRenderHost) => string,
  check?: (claim: Extract<ExtensionClaim, { form: 'div' }>) => void,
): Required<Pick<PressExtension, 'extensions' | 'renderers'>> {
  return {
    extensions: [
      {
        name,
        version: '1',
        matcher: { form: 'div', name: div },
        props: {},
        slots: {},
        transform(claim) {
          if (claim.form !== 'div') return null
          check?.(claim)
          const node: BlockExtensionNode = {
            type: 'block_extension',
            name,
            version: '1',
            children: claim.body,
            fallback: structuredClone(claim.body),
            ...(claim.attrs === undefined ? {} : { attrs: claim.attrs }),
          }
          if (claim.node.pos !== undefined) node.pos = claim.node.pos
          return node
        },
      },
    ],
    renderers: { [name]: { version: '1', render: (node, host) => render(node as BlockExtensionNode, host) } },
  }
}
