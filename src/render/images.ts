import { readFileSync } from 'node:fs'
import { isAbsolute, relative as relativePath, resolve } from 'node:path'
import type { CarveExtension } from '@markup-carve/carve'

interface ImageNode {
  type: string
  src?: string
  attrs?: { keyValues?: Record<string, string>; order?: string[] }
  children?: ImageNode[]
}

interface ImageSize {
  width: number
  height: number
}

function attrs(node: ImageNode): { keyValues: Record<string, string>; order: string[] } {
  node.attrs ??= {}
  node.attrs.keyValues ??= {}
  node.attrs.order ??= []
  return { keyValues: node.attrs.keyValues, order: node.attrs.order }
}

function setDefault(node: ImageNode, key: string, value: string): void {
  const { keyValues, order } = attrs(node)
  if (Object.keys(keyValues).some((existing) => existing.toLowerCase() === key.toLowerCase())) return
  keyValues[key] = value
  order.push(key)
}

function png(buffer: Buffer): ImageSize | undefined {
  if (buffer.length < 24 || buffer.toString('ascii', 1, 4) !== 'PNG') return undefined
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

function gif(buffer: Buffer): ImageSize | undefined {
  const sig = buffer.toString('ascii', 0, 6)
  if (buffer.length < 10 || (sig !== 'GIF87a' && sig !== 'GIF89a')) return undefined
  return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) }
}

function jpeg(buffer: Buffer): ImageSize | undefined {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return undefined
  let offset = 2
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) return undefined
    const marker = buffer[offset + 1]
    const length = buffer.readUInt16BE(offset + 2)
    if (length < 2) return undefined
    if (marker !== undefined && marker >= 0xc0 && marker <= 0xc3) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) }
    }
    offset += 2 + length
  }
  return undefined
}

function webp(buffer: Buffer): ImageSize | undefined {
  if (buffer.length < 30 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') return undefined
  const type = buffer.toString('ascii', 12, 16)
  if (type === 'VP8 ') return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff }
  if (type === 'VP8L') {
    const b0 = buffer[21]
    const b1 = buffer[22]
    const b2 = buffer[23]
    const b3 = buffer[24]
    if (b0 === undefined || b1 === undefined || b2 === undefined || b3 === undefined) return undefined
    return { width: 1 + (((b1 & 0x3f) << 8) | b0), height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) }
  }
  if (type === 'VP8X') return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) }
  return undefined
}

function svg(buffer: Buffer): ImageSize | undefined {
  const text = buffer.toString('utf8', 0, Math.min(buffer.length, 4096))
  if (!/<svg[\s>]/i.test(text)) return undefined
  const tag = /<svg\b([^>]*)>/i.exec(text)?.[1]
  if (tag === undefined) return undefined
  const attr = (name: string) => new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i').exec(tag)?.[1]
  const num = (value: string | undefined) => {
    if (value === undefined) return undefined
    const match = /^([0-9]+(?:\.[0-9]+)?)/.exec(value.trim())
    return match === null ? undefined : Number(match[1])
  }
  const width = num(attr('width'))
  const height = num(attr('height'))
  if (width !== undefined && height !== undefined) return { width, height }
  const viewBox = attr('viewBox')?.trim().split(/\s+/).map(Number)
  if (viewBox?.length === 4 && viewBox.every(Number.isFinite)) return { width: viewBox[2]!, height: viewBox[3]! }
  return undefined
}

function probe(path: string): ImageSize | undefined {
  try {
    const buffer = readFileSync(path)
    return png(buffer) ?? jpeg(buffer) ?? gif(buffer) ?? webp(buffer) ?? svg(buffer)
  } catch {
    return undefined
  }
}

/**
 * Only root-relative sources are probed, and only inside publicDir.
 *
 * A relative source is resolved against the page that wrote it, and the render
 * stack is built once for the whole site, so this extension does not know which
 * page it is looking at. Guessing srcDir would silently stamp the dimensions of
 * a same-named file from another directory onto the image. Containment matters
 * for the same reason it always does: `![](/../../secrets.png)` should not make
 * the build read outside the site.
 */
function imagePath(src: string, opts: { root: string; publicDir: string }): string | undefined {
  if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('//') || src.startsWith('#')) return undefined
  if (!src.startsWith('/')) return undefined
  const clean = src.split(/[?#]/, 1)[0] ?? ''
  if (clean === '') return undefined
  const publicRoot = resolve(opts.root, opts.publicDir)
  const path = resolve(publicRoot, clean.replace(/^\/+/, ''))
  const relative = relativePath(publicRoot, path)
  return relative === '' || relative.startsWith('..') || isAbsolute(relative) ? undefined : path
}

function visit(node: ImageNode, opts: { root: string; publicDir: string }): void {
  if (node.type === 'image') {
    setDefault(node, 'loading', 'lazy')
    setDefault(node, 'decoding', 'async')
    const path = node.src === undefined ? undefined : imagePath(node.src, opts)
    const size = path === undefined ? undefined : probe(path)
    if (size !== undefined) {
      setDefault(node, 'width', String(size.width))
      setDefault(node, 'height', String(size.height))
    }
  }
  for (const child of node.children ?? []) visit(child, opts)
}

export function imageDefaultsExtension(opts: { root: string; publicDir: string }): CarveExtension {
  return {
    name: 'carve-press-images',
    beforeRender(doc) {
      visit(doc as unknown as ImageNode, opts)
      return doc
    },
  }
}

