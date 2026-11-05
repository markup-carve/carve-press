import { SourceError } from '../errors.js'
import { LineCounter, parseDocument } from 'yaml'

/** Mirrors the engine's frontmatter recognition so both agree on what is metadata. */
const RE_OPEN = /^---[ \t]*(\w*)\s*$/
const RE_CLOSE = /^---\s*$/

export interface FrontmatterSplit {
  data: Record<string, unknown>
  body: string
  /** 1-based line in the original file where `body` starts. */
  bodyStartLine: number
}

/**
 * Split leading frontmatter off a Carve document.
 */
export function splitFrontmatter(source: string, srcPath = '<input>'): FrontmatterSplit {
  const lines = source.split('\n')
  if (!RE_OPEN.test(lines[0]!)) {
    return { data: {}, body: source, bodyStartLine: 1 }
  }
  const close = lines.findIndex((l, i) => i > 0 && RE_CLOSE.test(l))
  // The engine reads an unclosed opener as frontmatter to the end of the file
  // (carve#5016), so the page would render empty.
  if (close === -1) {
    throw new SourceError(
      srcPath,
      1,
      1,
      'frontmatter: the opening --- has no closing --- line, so the whole file would be metadata; close it, or write a thematic break as ***',
    )
  }

  const raw = lines.slice(1, close).join('\n')
  let value: unknown
  try {
    const lineCounter = new LineCounter()
    const doc = parseDocument(raw, { lineCounter, prettyErrors: false })
    if (doc.errors.length > 0) {
      const error = doc.errors[0]!
      const pos = error.linePos?.[0] ?? lineCounter.linePos(error.pos[0])
      throw new SourceError(srcPath, pos.line + 1, pos.col, `frontmatter: ${error.message}`)
    }
    value = doc.toJS()
  } catch (error) {
    if (error instanceof SourceError) throw error
    const reason = error instanceof Error ? error.message : String(error)
    throw new SourceError(srcPath, 2, 1, `frontmatter: ${reason}`)
  }

  if (value === null) {
    return {
      data: {},
      body: lines.slice(close + 1).join('\n'),
      bodyStartLine: close + 2,
    }
  }
  if (
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new SourceError(srcPath, 2, 1, 'frontmatter: expected a YAML mapping')
  }

  return {
    data: value as Record<string, unknown>,
    body: lines.slice(close + 1).join('\n'),
    bodyStartLine: close + 2,
  }
}
