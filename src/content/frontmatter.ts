import { SourceError } from '../errors.js'

/** Mirrors the engine's frontmatter recognition so both agree on what is metadata. */
const RE_OPEN = /^---[ \t]*(\w*)\s*$/
const RE_CLOSE = /^---\s*$/

export interface FrontmatterSplit {
  data: Record<string, unknown>
  body: string
  /** 1-based line in the original file where `body` starts. */
  bodyStartLine: number
}

function coerce(raw: string): unknown {
  const v = raw.trim()
  if (
    (v.startsWith('"') && v.endsWith('"') && v.length >= 2) ||
    (v.startsWith("'") && v.endsWith("'") && v.length >= 2)
  ) {
    return v.slice(1, -1)
  }
  if (v === 'true') return true
  if (v === 'false') return false
  if (/^-?\d+$/.test(v)) return Number(v)
  return v
}

/**
 * Split leading frontmatter off a Carve document.
 *
 * Only flat `key: value` scalars are supported. A nested key is an error rather
 * than a silent drop: a page that quietly loses metadata is the failure mode
 * this whole pipeline is built to avoid.
 */
export function splitFrontmatter(source: string, srcPath = '<input>'): FrontmatterSplit {
  const lines = source.split('\n')
  if (lines.length < 2 || !RE_OPEN.test(lines[0]!)) {
    return { data: {}, body: source, bodyStartLine: 1 }
  }
  const close = lines.findIndex((l, i) => i > 0 && RE_CLOSE.test(l))
  if (close === -1) return { data: {}, body: source, bodyStartLine: 1 }

  const data: Record<string, unknown> = {}
  for (let i = 1; i < close; i++) {
    const line = lines[i]!
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    if (/^\s/.test(line)) {
      throw new SourceError(srcPath, i + 1, 1, 'frontmatter: nested values are not supported')
    }
    const sep = line.indexOf(':')
    if (sep === -1) {
      throw new SourceError(srcPath, i + 1, 1, `frontmatter: expected "key: value", got "${line}"`)
    }
    const key = line.slice(0, sep).trim()
    const value = line.slice(sep + 1)
    data[key] = coerce(value)
  }

  return {
    data,
    body: lines.slice(close + 1).join('\n'),
    bodyStartLine: close + 2,
  }
}
