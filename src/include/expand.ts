import { readFileSync } from 'node:fs'
import { resolve, dirname, relative, isAbsolute } from 'node:path'
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
function sectionFor(lines: string[], anchor: string): string[] | null {
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
      return lines.slice(start, end)
    }
  }
  return start === -1 ? null : lines.slice(start)
}

function assertInsideRoots(abs: string, roots: string[], srcPath: string, line: number): void {
  const ok = roots.some((root) => {
    const rel = relative(root, abs)
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
  })
  if (!ok) {
    throw new SourceError(srcPath, line, 1, `include: "${abs}" is outside the allowed roots`)
  }
}

export function expandIncludes(
  source: string,
  opts: ExpandOptions,
): { source: string; map: IncludeSourceMap } {
  const origins: Origin[] = []

  function expand(text: string, srcPath: string, baseDir: string, stack: string[]): string[] {
    const lines = text.split('\n')
    const out: string[] = []
    let fence: string | null = null

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      const fenceMatch = RE_FENCE.exec(line.trim())
      if (fence !== null) {
        if (fenceMatch && line.trim().startsWith(fence)) fence = null
        out.push(line)
        origins.push({ srcPath, line: i + 1 })
        continue
      }
      if (fenceMatch) {
        fence = fenceMatch[1]!
        out.push(line)
        origins.push({ srcPath, line: i + 1 })
        continue
      }

      const m = RE_DIRECTIVE.exec(line)
      if (!m?.groups) {
        out.push(line)
        origins.push({ srcPath, line: i + 1 })
        continue
      }

      const abs = resolve(baseDir, m.groups.path!)
      assertInsideRoots(abs, opts.roots, srcPath, i + 1)
      if (stack.includes(abs)) {
        throw new SourceError(srcPath, i + 1, 1, `include cycle: ${[...stack, abs].join(' -> ')}`)
      }

      let raw: string
      try {
        raw = readFileSync(abs, 'utf8')
      } catch {
        // Location is folded into the message (not just the srcPath/line/column
        // fields) because this is the one include failure a page author hits
        // directly and expects to see pinpointed even from a bare .message read.
        throw new SourceError(
          srcPath,
          i + 1,
          1,
          `${srcPath}:${i + 1}:1 include: cannot read "${m.groups.path}"`,
        )
      }

      let body = raw.replace(/\n$/, '').split('\n')
      if (m.groups.anchor !== undefined) {
        const section = sectionFor(body, m.groups.anchor)
        if (section === null) {
          throw new SourceError(
            srcPath,
            i + 1,
            1,
            `include: no heading with slug "${m.groups.anchor}" in "${m.groups.path}"`,
          )
        }
        body = section
      } else if (m.groups.start !== undefined || m.groups.end !== undefined) {
        const from = m.groups.start !== undefined ? Number(m.groups.start) - 1 : 0
        const to = m.groups.end !== undefined ? Number(m.groups.end) : body.length
        body = body.slice(from, to)
      }

      out.push(...expand(body.join('\n'), abs, dirname(abs), [...stack, abs]))
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
