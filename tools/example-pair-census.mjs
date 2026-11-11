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

// The byte transforms the spec generator applies to a fence body before it
// writes the .crv (applyModifiers in scripts/generate-corpus.mjs). `no-render`
// changes no bytes.
function fixtureBytes(body, modifiers) {
  let out = body + '\n'
  if (modifiers.has('no-final-newline')) out = out.replace(/\n$/, '')
  if (modifiers.has('crlf')) out = out.replace(/\n/g, '\r\n')
  if (modifiers.has('cr')) out = out.replace(/\n/g, '\r')
  if (modifiers.has('bom')) out = '\ufeff' + out
  if (modifiers.has('nul')) out = out.replace(/\u2400/g, '\u0000')
  return out
}

/**
 * The .crv bytes of every pair a page declares. The spec generator writes one
 * fixture per distinct input, so a deduplicating corpus holds as many pairs as
 * there are distinct entries across all source pages.
 *
 * @param {string} source @returns {string[]}
 */
export function declaredInputs(source) {
  const inputs = []
  let block = null
  let modifiers = new Set()
  let fence = null
  let body = null
  for (const line of source.split('\n')) {
    if (fence !== null) {
      if (line.startsWith(fence) && line.slice(fence.length).trim() === '') {
        // The generator skips a pair whose carve body is empty.
        if (body !== null && body.join('\n') !== '') inputs.push(fixtureBytes(body.join('\n'), modifiers))
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
        modifiers = new Set(rest.trim().split(/[ \t]+/).slice(1))
      }
    } else if (trimmed === block) {
      block = null
    }
  }
  return inputs
}
