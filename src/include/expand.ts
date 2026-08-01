import { readFileSync, realpathSync } from 'node:fs'
import { resolve, dirname, basename, relative, isAbsolute } from 'node:path'
import { SourceError } from '../errors.js'

const RE_DIRECTIVE =
  /^%%[ \t]*@include:[ \t]*(?<path>[^\s{#]+)(?:#(?<anchor>[^\s{]+))?(?:\{(?<start>\d+)?,(?<end>\d+)?\})?[ \t]*$/
const RE_FENCE = /^(`{3,}|~{3,})/

/** One expanded line's origin. */
interface Origin {
  srcPath: string
  line: number
}

export interface IncludeSourceMap {
  /** Resolve a 1-based line in the expanded source back to its origin. */
  resolve(line: number): Origin
}

export interface ExpandOptions {
  /** Path used in error messages for the document being expanded. */
  srcPath: string
  /** Directory that relative include paths resolve against. */
  baseDir: string
  /** Absolute directories an include is allowed to read from. */
  roots: string[]
}

function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
}

/** Extract a heading section: from the matching heading to the next same-or-higher one. */
function sectionFor(lines: string[], anchor: string): { lines: string[]; offset: number } | null {
  let start = -1
  let level = 0
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})[ \t]+(.*)$/.exec(lines[i]!)
    if (!m) continue
    if (start === -1) {
      if (slugify(m[2]!) === anchor) {
        start = i
        level = m[1]!.length
      }
      continue
    }
    if (m[1]!.length <= level) {
      // Drop the blank separator line(s) directly before the next heading;
      // they belong to the document's flow, not to this extracted section.
      let end = i
      while (end > start && lines[end - 1] === '') end--
      return { lines: lines.slice(start, end), offset: start }
    }
  }
  return start === -1 ? null : { lines: lines.slice(start), offset: start }
}

/**
 * Resolve as much of `p` as actually exists through `realpathSync`, then
 * reappend any missing tail lexically. A plain `realpathSync(p)` throws
 * outright when `p` (e.g. a missing include target) doesn't exist, which
 * would force callers to compare a resolved root against an unresolved
 * path - and if a root itself is a symlink, that mismatch misclassifies an
 * in-root missing file as outside the roots instead of reaching the
 * "cannot read" error.
 */
function resolveRealish(p: string): string {
  try {
    return realpathSync(p)
  } catch {
    const parent = dirname(p)
    if (parent === p) return p
    return resolve(resolveRealish(parent), basename(p))
  }
}

function assertInsideRoots(abs: string, roots: string[], srcPath: string, line: number): string {
  const real = resolveRealish(abs)
  const ok = roots.some((root) => {
    const rel = relative(resolveRealish(root), real)
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
  })
  if (!ok) {
    throw new SourceError(srcPath, line, 1, `include: "${abs}" is outside the allowed roots`)
  }
  return real
}

export function expandIncludes(
  source: string,
  opts: ExpandOptions,
): { source: string; map: IncludeSourceMap } {
  const origins: Origin[] = []

  function expand(
    text: string,
    srcPath: string,
    baseDir: string,
    stack: string[],
    lineOffset = 0,
  ): string[] {
    const lines = text.split('\n')
    const out: string[] = []
    let fence: string | null = null

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      const fenceMatch = RE_FENCE.exec(line.trim())
      if (fence !== null) {
        if (fenceMatch && line.trim().startsWith(fence)) fence = null
        out.push(line)
        origins.push({ srcPath, line: i + 1 + lineOffset })
        continue
      }
      if (fenceMatch) {
        fence = fenceMatch[1]!
        out.push(line)
        origins.push({ srcPath, line: i + 1 + lineOffset })
        continue
      }

      const m = RE_DIRECTIVE.exec(line)
      if (!m?.groups) {
        out.push(line)
        origins.push({ srcPath, line: i + 1 + lineOffset })
        continue
      }

      // The reported line is relative to srcPath, the file this directive was
      // read from - which may itself be a sliced include, hence + lineOffset.
      const directiveLine = i + 1 + lineOffset

      // The REAL path is what gets read and what keys cycle detection, so a
      // symlink cannot be validated as one path and read as another.
      const abs = assertInsideRoots(
        resolve(baseDir, m.groups.path!),
        opts.roots,
        srcPath,
        directiveLine,
      )
      if (stack.includes(abs)) {
        throw new SourceError(
          srcPath,
          directiveLine,
          1,
          `include cycle: ${[...stack, abs].join(' -> ')}`,
        )
      }

      let raw: string
      try {
        raw = readFileSync(abs, 'utf8')
      } catch {
        throw new SourceError(srcPath, directiveLine, 1, `include: cannot read "${m.groups.path}"`)
      }

      let body = raw.replace(/\n$/, '').split('\n')
      // How far into the included file the kept slice begins. Without this the
      // source map reports every ranged or anchored include as starting at
      // line 1, so an error inside one points at the wrong line.
      let sliceOffset = 0
      if (m.groups.anchor !== undefined) {
        const section = sectionFor(body, m.groups.anchor)
        if (section === null) {
          throw new SourceError(
            srcPath,
            directiveLine,
            1,
            `include: no heading with slug "${m.groups.anchor}" in "${m.groups.path}"`,
          )
        }
        body = section.lines
        sliceOffset = section.offset
      } else if (m.groups.start !== undefined || m.groups.end !== undefined) {
        const from = m.groups.start !== undefined ? Number(m.groups.start) - 1 : 0
        const to = m.groups.end !== undefined ? Number(m.groups.end) : body.length
        body = body.slice(from, to)
        sliceOffset = from
      }

      out.push(...expand(body.join('\n'), abs, dirname(abs), [...stack, abs], sliceOffset))
    }
    return out
  }

  // Fast path: nothing to do, and the map is the identity.
  if (!source.includes('@include:')) {
    return {
      source,
      map: { resolve: (line) => ({ srcPath: opts.srcPath, line }) },
    }
  }

  const expanded = expand(source, opts.srcPath, opts.baseDir, [])
  return {
    source: expanded.join('\n'),
    map: {
      resolve(line) {
        return origins[line - 1] ?? { srcPath: opts.srcPath, line }
      },
    },
  }
}
