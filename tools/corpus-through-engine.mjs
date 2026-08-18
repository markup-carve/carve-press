#!/usr/bin/env node
/*
 * Render every document of the spec corpus through a carve-js build and count
 * the ones that come out differently.
 *
 * THE ARTIFACT, NOT THE VERSION STRING. A revision distance is a proxy: 300
 * commits can change nothing and one can break a construct. This repo's pin sat
 * 333 commits behind while a check that compared revisions reported it as a
 * warning, and nothing said that 256 of 1131 documents were rendering wrongly
 * (carve-press#19). Only rendering the documents says what an engine does.
 *
 *   node tools/corpus-through-engine.mjs <engine-entry> <corpus-dir>
 *        [--reference <engine-entry>] [--list] [--baseline=<file>]
 *
 * With `--reference`, a second engine renders the same documents and the
 * difference is reported as `attributable`: the documents this repository can
 * fix by moving its pin, as opposed to the ones carve-js has not implemented
 * yet, which no pin here can close.
 *
 * With `--baseline`, the divergent documents are held against a recorded list
 * of NAMES rather than a count, and the run exits non-zero when a document that
 * rendered correctly at the freeze renders differently now. A count cannot
 * carry that: one document regressing while another is fixed leaves the total
 * untouched and a ceiling silent.
 *
 * Prints `key=value` lines for the workflow to read.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

const argv = process.argv.slice(2)
const positional = []
let referencePath
let baselinePath
let list = false
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--reference') referencePath = argv[++i]
  else if (argv[i] === '--list') list = true
  else if (argv[i].startsWith('--baseline=')) baselinePath = argv[i].slice('--baseline='.length)
  else positional.push(argv[i])
}
const [enginePath, corpusDir] = positional
if (enginePath === undefined || corpusDir === undefined) {
  process.stderr.write(
    'usage: corpus-through-engine.mjs <engine-entry> <corpus-dir> [--reference <engine-entry>] [--list] [--baseline=<file>]\n',
  )
  process.exit(2)
}

/**
 * How many documents the corpus is SUPPOSED to hold, derived from something
 * this script does not itself read as the population.
 *
 * Without it an absent or truncated corpus renders zero documents, reports zero
 * divergences and passes - which is the exact shape of check this file exists
 * to replace. Counting the corpus directory to decide how big the corpus should
 * be would move both sides of the comparison together and guard nothing, and a
 * hardcoded 1131 is the same defect with a bigger number, going stale the day
 * an example lands upstream.
 *
 * So the reference is the corpus's SOURCE: tests/corpus is generated from the
 * `::: compare` blocks in resources/examples/{core,extensions,edge-cases}.md,
 * one block per pair, and the generator refuses to write a corpus where the two
 * disagree. Both live in the same checkout, so this costs no second clone.
 */
function declaredCorpusSize(dir) {
  const examplesDir = resolve(dir, '..', '..', 'resources', 'examples')
  let declared = 0
  for (const page of ['core.md', 'extensions.md', 'edge-cases.md']) {
    const path = join(examplesDir, page)
    if (!existsSync(path)) {
      // Not a soft skip: without this page there is no independent statement of
      // how big the corpus should be, and a corpus check with nothing to compare
      // against is the failure shape being removed here.
      process.stderr.write(
        `::error::no corpus source page at ${path}; tests/corpus is generated from these pages, so if the spec moved them this guard has to move with them\n`,
      )
      process.exit(1)
    }
    // Mirrors the generator's state machine rather than grepping: a
    // `::: compare` line inside an already-open block is content, not a second
    // pair, and a block closes on a bare marker line.
    let marker = null
    for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
      const line = rawLine.trim()
      if (marker !== null) {
        if (line === marker) marker = null
        continue
      }
      const m = /^(:{3,})\s+compare(\s+\S.*)?$/.exec(line)
      if (m !== null) {
        declared++
        marker = m[1]
      }
    }
  }
  if (declared === 0) {
    process.stderr.write(
      `::error::the corpus source pages under ${examplesDir} declare no ::: compare blocks at all; that is a wiring problem, not a corpus of size zero\n`,
    )
    process.exit(1)
  }
  return declared
}

async function loadEngine(path) {
  const mod = await import(pathToFileURL(resolve(path)).href)
  if (typeof mod.carveToHtml !== 'function') {
    process.stderr.write(`::error::${path} exports no carveToHtml - that is not a carve-js build\n`)
    process.exit(1)
  }
  return mod.carveToHtml
}

function pairs(dir) {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.crv'))
    .sort()
    .map((name) => ({ name, expected: join(dir, name.slice(0, -4) + '.html') }))
    .filter((pair) => existsSync(pair.expected))
}

/** The set of document names this engine renders differently from the corpus. */
function diverging(carveToHtml, dir, all) {
  const wrong = new Set()
  let threw = 0
  for (const pair of all) {
    const source = readFileSync(join(dir, pair.name), 'utf8')
    let got
    try {
      got = carveToHtml(source)
    } catch {
      threw++
      wrong.add(pair.name)
      continue
    }
    if (got.trim() !== readFileSync(pair.expected, 'utf8').trim()) wrong.add(pair.name)
  }
  return { wrong, threw }
}

/**
 * Hold the divergent documents against the list recorded at the pinned freeze.
 *
 * The corpus is pinned to a commit and the engine to a revision the lockfile
 * records, so both ends of this measurement are fixed and only a change in THIS
 * repository can move the divergent set. That is what makes a name appearing
 * here attributable: it is the engine pin this pull request moved, not the spec
 * moving underneath a floating checkout.
 *
 * Comparing counts would miss the case that matters most - one document
 * regressing while another is fixed leaves the total unchanged and a ceiling
 * silent - so the comparison is by name.
 *
 * @param {string} path Recorded divergences file.
 * @param {Set<string>} wrong Documents that rendered differently in this run.
 * @param {string[]} present Every document the pinned corpus actually holds.
 * @returns {number} Process exit status.
 */
function compareAgainstBaseline(path, wrong, present) {
  if (!existsSync(path)) {
    process.stderr.write(`::error::no recorded divergences at ${path}; without them this run has nothing to be worse than\n`)
    return 2
  }

  const recorded = readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))

  if (recorded.length === 0) {
    process.stderr.write(
      `::error::${path} names no documents at all; that is a wiring problem, not a tree that renders the whole corpus correctly\n`,
    )
    return 1
  }

  // A recorded name the corpus does not hold means the corpus is not the one
  // the record was measured against, so neither verdict below would mean
  // anything. Report that instead of returning one.
  const held = new Set(present)
  const absent = recorded.filter((name) => !held.has(name))
  if (absent.length > 0) {
    process.stderr.write(
      `::error::the recorded divergences name ${absent.length} document(s) this corpus does not hold ` +
        `(${absent.slice(0, 10).join(', ')}${absent.length > 10 ? ', ...' : ''}). The corpus checked out here is not the ` +
        'pinned freeze they were measured against, so nothing in this run is a statement about this repository. Fix the ' +
        'ref in the workflow, or re-measure and re-record if the pin moved on purpose.\n',
    )
    return 1
  }

  const recordedSet = new Set(recorded)
  const regressed = [...wrong].filter((name) => !recordedSet.has(name)).sort()
  const improved = recorded.filter((name) => !wrong.has(name)).sort()

  if (regressed.length > 0) {
    process.stderr.write(
      `::error::${regressed.length} document(s) render differently now that rendered correctly at the freeze: ` +
        `${regressed.join(', ')}. The corpus ref and the engine revision are both pinned, so this is a change in this ` +
        'pull request and not upstream movement.\n',
    )
    return 1
  }

  if (improved.length > 0) {
    process.stderr.write(
      `::warning::${improved.length} document(s) recorded as divergent render correctly now: ${improved.join(', ')}. ` +
        `Delete those lines from ${path} so the record keeps meaning what it says.\n`,
    )
  }

  process.stdout.write(`regressed=${regressed.length}\n`)
  process.stdout.write(`improved=${improved.length}\n`)
  return 0
}

const all = pairs(corpusDir)
const declared = declaredCorpusSize(corpusDir)
if (all.length !== declared) {
  process.stderr.write(
    `::error::${all.length} corpus pairs found in ${corpusDir}, but the spec's example pages declare ${declared}. ` +
      'Every ::: compare block in resources/examples/{core,extensions,edge-cases}.md becomes one corpus pair, so a ' +
      'difference means the corpus checked out here is not the one those pages describe - a truncated or stale ' +
      'checkout, or a corpus that needs regenerating. It does not mean this run was clean.\n',
  )
  process.exit(1)
}

const engine = await loadEngine(enginePath)
const measured = diverging(engine, corpusDir, all)

let referenceWrong = 0
let attributable = measured.wrong.size
if (referencePath !== undefined) {
  const reference = await loadEngine(referencePath)
  const referenceResult = diverging(reference, corpusDir, all)
  referenceWrong = referenceResult.wrong.size
  attributable = [...measured.wrong].filter((name) => !referenceResult.wrong.has(name)).length
}

if (list) {
  for (const name of [...measured.wrong].sort()) process.stdout.write(`wrong: ${name}\n`)
}
process.stdout.write(`documents=${all.length}\n`)
process.stdout.write(`wrong=${measured.wrong.size}\n`)
process.stdout.write(`threw=${measured.threw}\n`)
process.stdout.write(`reference_wrong=${referenceWrong}\n`)
process.stdout.write(`attributable=${attributable}\n`)

if (baselinePath !== undefined) {
  process.exit(compareAgainstBaseline(baselinePath, measured.wrong, all.map((pair) => pair.name)))
}
