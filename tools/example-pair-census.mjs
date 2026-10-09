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
