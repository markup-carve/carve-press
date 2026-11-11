// Counts the corpus pairs an example page declares: one per `carve` fence
// inside a `::: compare` block. A block may hold several pairs, and nothing
// inside a fence is markup. Same rule as scripts/lib/example-pair-census.mjs
// in the spec repository.

const leadingRun = (s, ch) => {
  let n = 0
  while (n < s.length && s[n] === ch) n++
  return n
}

/** @param {string} source @returns {number} */
export function declaredPairs(source) {
  let pairs = 0
  let block = null
  let fence = null
  for (const line of source.split('\n')) {
    if (fence !== null) {
      if (line.startsWith(fence) && line.slice(fence.length).trim() === '') fence = null
      continue
    }
    const ticks = leadingRun(line, '`')
    if (ticks >= 3) {
      fence = line.slice(0, ticks)
      if (block !== null && line.slice(ticks).trim() === 'carve') pairs++
      continue
    }
    const trimmed = line.trim()
    const colons = leadingRun(trimmed, ':')
    if (colons < 3) continue
    if (block === null) {
      if (/^[ \t]+compare(?:[ \t]|$)/.test(trimmed.slice(colons))) block = trimmed.slice(0, colons)
    } else if (trimmed === block) {
      block = null
    }
  }
  return pairs
}

// Modifiers that change the fixture's bytes. `no-render` does not, so two
// blocks that differ only by it write the same .crv.
const BYTE_MODIFIERS = new Set(['crlf', 'cr', 'bom', 'nul', 'no-final-newline'])

/**
 * One key per pair, naming the .crv bytes it generates: the carve fence body
 * plus the byte-changing modifiers of its compare block. Since the spec
 * generator writes one fixture per distinct input, the corpus holds as many
 * pairs as there are distinct keys across all source pages.
 *
 * @param {string} source @returns {string[]}
 */
export function declaredInputs(source) {
  const keys = []
  let block = null
  let modifiers = ''
  let fence = null
  let body = null
  for (const line of source.split('\n')) {
    if (fence !== null) {
      if (line.startsWith(fence) && line.slice(fence.length).trim() === '') {
        if (body !== null) keys.push(`${modifiers}\0${body.join('\n')}`)
        fence = null
        body = null
      } else if (body !== null) {
        body.push(line)
      }
      continue
    }
    const ticks = leadingRun(line, '`')
    if (ticks >= 3) {
      fence = line.slice(0, ticks)
      if (block !== null && line.slice(ticks).trim() === 'carve') body = []
      continue
    }
    const trimmed = line.trim()
    const colons = leadingRun(trimmed, ':')
    if (colons < 3) continue
    if (block === null) {
      const rest = trimmed.slice(colons)
      if (/^[ \t]+compare(?:[ \t]|$)/.test(rest)) {
        block = trimmed.slice(0, colons)
        modifiers = rest.trim().split(/[ \t]+/).slice(1).filter((m) => BYTE_MODIFIERS.has(m)).sort().join(' ')
      }
    } else if (trimmed === block) {
      block = null
    }
  }
  return keys
}
