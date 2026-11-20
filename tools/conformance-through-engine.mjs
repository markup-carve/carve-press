#!/usr/bin/env node
/*
 * Render every render case of the Carve 0.2 conformance corpus through the
 * installed engine and hold the divergent ones against a recorded list of ids.
 *
 *   node tools/conformance-through-engine.mjs <engine-entry> <conformance-dir> [--list] [--baseline=<file>]
 *
 * The 0.2 corpus is `spec/0.2/conformance/` (examples.json, clause-cases.json),
 * not the 0.1 `tests/corpus` directory. A case runs when it renders HTML and
 * its options are plain data: a case whose options are host code (extensions,
 * renderers, a code block renderer, social resolvers) is counted as skipped.
 *
 * Prints `key=value` lines for the workflow to read; exits 1 when a case that is
 * not in the baseline diverges, and warns for a recorded id that now passes.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const argv = process.argv.slice(2)
const positional = argv.filter((arg) => !arg.startsWith('--'))
const list = argv.includes('--list')
const baselinePath = argv.find((arg) => arg.startsWith('--baseline='))?.slice('--baseline='.length)
const [enginePath, dir] = positional
if (enginePath === undefined || dir === undefined) {
  console.error('usage: conformance-through-engine.mjs <engine-entry> <conformance-dir> [--list] [--baseline=<file>]')
  process.exit(2)
}

const engine = await import(pathToFileURL(resolve(enginePath)).href)
const read = (name) => JSON.parse(readFileSync(resolve(dir, name), 'utf8'))
const examples = read('examples.json').examples
const clauseCases = read('clause-cases.json').cases

const HOST_CODE = new Set(['extensions', 'renderers', 'codeBlockRenderer', 'social', 'includes'])

function resolverFor(files) {
  return ({ path }) => {
    const file = files[path]
    if (file === undefined) return { error: 'not_found' }
    if (file.bytes !== undefined) {
      return { text: Uint8Array.from(file.bytes.split(/\s+/).filter(Boolean).map((hex) => Number.parseInt(hex, 16))), id: path }
    }
    return { text: file.text, id: path }
  }
}

const cases = []
for (const example of examples) {
  if (example.kind !== 'render' && example.kind !== 'include') continue
  cases.push({ id: example.id, input: example.input, files: example.files, options: example.options ?? {}, html: example.expected?.html })
}
for (const entry of clauseCases) {
  if ((entry.kind ?? 'render') !== 'render' || entry.tree !== undefined) continue
  cases.push({ id: entry.id, input: entry.input, inputBytes: entry.inputBytes, files: entry.files, options: entry.options ?? {}, html: entry.expected?.html })
}

let documents = 0
let skipped = 0
const wrong = []
for (const entry of cases) {
  if (typeof entry.html !== 'string' || Object.keys(entry.options).some((key) => HOST_CODE.has(key))) {
    skipped++
    continue
  }
  if (entry.input === undefined && entry.inputBytes === undefined) {
    skipped++
    continue
  }
  documents++
  const source = entry.input ?? Uint8Array.from(entry.inputBytes.split(/\s+/).filter(Boolean).map((hex) => Number.parseInt(hex, 16)))
  const options = { ...entry.options, ...(entry.files === undefined ? {} : { includes: resolverFor(entry.files) }) }
  let html
  try {
    html = engine.renderWithDiagnostics(source, options).html
  } catch (error) {
    html = `THROWN: ${error instanceof Error ? error.message : String(error)}`
  }
  if (html !== entry.html) wrong.push(entry.id)
}

console.log(`documents=${documents}`)
console.log(`skipped=${skipped}`)
console.log(`wrong=${wrong.length}`)
if (list) for (const id of wrong) console.log(`divergent ${id}`)

if (baselinePath !== undefined) {
  const recorded = new Set(
    readFileSync(baselinePath, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#')),
  )
  const known = new Set(cases.map((entry) => entry.id))
  const fresh = wrong.filter((id) => !recorded.has(id))
  const fixed = [...recorded].filter((id) => known.has(id) && !wrong.includes(id))
  const absent = [...recorded].filter((id) => !known.has(id))
  for (const id of absent) console.log(`::error::${id} is recorded but the corpus has no such case: the checkout is not the pinned spec commit`)
  for (const id of fixed) console.log(`::warning::${id} renders correctly now; delete its line from ${baselinePath}`)
  for (const id of fresh) console.log(`::error::${id} renders differently from the corpus and is not recorded: this branch changed it`)
  if (fresh.length > 0 || absent.length > 0) process.exit(1)
}
