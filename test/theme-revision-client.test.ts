import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { carveToHtml } from '@markup-carve/carve'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

const chromeFlags = ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']

const chromeCandidates = [
  process.env.CHROME_BIN,
  '/bin/google-chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter((candidate): candidate is string => Boolean(candidate))

function chromeBin(): string | undefined {
  return chromeCandidates.find((candidate) => existsSync(candidate))
}

async function canDriveChrome(bin: string): Promise<boolean> {
  try {
    await execFileAsync(bin, [...chromeFlags, '--dump-dom', 'about:blank'], { timeout: 5000 })
    return true
  } catch {
    return false
  }
}

/**
 * WCAG AA for body-size prose. A sibling repo chose 7:1 for a deck projected in
 * a lit room; this theme renders documentation at reading size on a screen the
 * reader controls, so the AA floor is the bar the pair has to clear.
 */
const MIN_CONTRAST = 4.5

/** Below this a wash is a rounding difference rather than a signal a reader sees. */
const MIN_WASH = 1.1

type Measured = {
  background: string
  color: string
  decoration: string
  contrast: number
  washAgainstPage: number
}

type Reading = {
  prefersDark: boolean
  dataTheme: string | null
  pageBackground: string
  plainInk: string
  ins: Measured
  del: Measured
  mark: Measured
  markIns: Measured
  markDel: Measured
}

/**
 * A CSS-text assertion cannot see a cascade result or a contrast ratio: the
 * tokens can be present in all three palette blocks and still compose to an
 * insertion that reads as plain text. So the page computes its own styles,
 * composites each translucent wash over the paper by hand (getComputedStyle
 * reports the declared rgba, not what the reader sees), and reports ratios.
 */
function fixtureHtml(css: string, rendered: string, themeAttribute: string): string {
  return `<!doctype html>
<html${themeAttribute}>
<head><meta charset="utf-8"><style>
${css}
</style></head>
<body><main class="content">${rendered}</main>
<script>
  const channel = (value) => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
  const parse = (value) => {
    const parts = value.match(/[-\\d.]+/g).map(Number)
    return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1]
  }
  const composite = (over, under) => [0, 1, 2].map((i) => over[3] * over[i] + (1 - over[3]) * under[i])
  const ratio = (a, b) => {
    const pair = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return Math.round(((pair[0] + 0.05) / (pair[1] + 0.05)) * 100) / 100
  }
  const page = parse(getComputedStyle(document.body).backgroundColor)
  const measure = (selector) => {
    const el = document.querySelector(selector)
    if (!el) throw new Error('nothing matched ' + selector)
    const style = getComputedStyle(el)
    const surface = composite(parse(style.backgroundColor), page)
    return {
      background: style.backgroundColor,
      color: style.color,
      decoration: style.textDecorationLine,
      contrast: ratio(composite(parse(style.color), surface), surface),
      washAgainstPage: ratio(surface, page.slice(0, 3)),
    }
  }
  const node = document.createElement('pre')
  node.id = 'result'
  try {
    node.textContent = JSON.stringify({
      prefersDark: matchMedia('(prefers-color-scheme: dark)').matches,
      dataTheme: document.documentElement.getAttribute('data-theme'),
      pageBackground: getComputedStyle(document.body).backgroundColor,
      plainInk: getComputedStyle(document.querySelector('main p')).color,
      ins: measure('p > ins'),
      del: measure('p > del'),
      mark: measure('mark'),
      markIns: measure('mark ins'),
      markDel: measure('mark del'),
    })
  } catch (error) {
    node.textContent = JSON.stringify({ error: error instanceof Error ? error.message : String(error) })
  }
  document.body.append(node)
</script>
</body></html>`
}

async function read(bin: string, themeAttribute: string, extraFlags: string[]): Promise<Reading> {
  const css = await readFile(resolve(import.meta.dirname, '../theme/default.css'), 'utf8')
  // Engine-rendered, not hand-written: a hand-written <ins> stops matching the
  // moment the engine changes which element a revision span becomes.
  const rendered = carveToHtml(
    'plain {+an insertion+} {-a deletion-} =a highlight= and ={+nested+} with {-dropped-}= tail',
  )
  const userDataDir = await mkdtemp(resolve(tmpdir(), 'cp-chrome-'))
  const fixtureDir = await mkdtemp(resolve(tmpdir(), 'cp-revision-'))
  const htmlPath = resolve(fixtureDir, 'index.html')
  try {
    await writeFile(htmlPath, fixtureHtml(css, rendered, themeAttribute))
    const { stdout } = await execFileAsync(
      bin,
      [
        ...chromeFlags,
        `--user-data-dir=${userDataDir}`,
        ...extraFlags,
        '--virtual-time-budget=20000',
        '--dump-dom',
        pathToFileURL(htmlPath).href,
      ],
      { maxBuffer: 1024 * 1024 * 20, timeout: 60000 },
    )
    const match = /<pre id="result">([\s\S]*?)<\/pre>/.exec(stdout)
    expect(match, 'the fixture never reported a reading').not.toBeNull()
    const payload = JSON.parse(
      match![1]
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&'),
    ) as Reading & { error?: string }
    // Assert the in-page message first: a shape mismatch hides it.
    expect(payload.error ?? 'ok').toBe('ok')
    return payload
  } finally {
    await rm(userDataDir, { force: true, recursive: true })
    await rm(fixtureDir, { force: true, recursive: true })
  }
}

/** All three palette blocks this file carries, each reached on its own terms. */
const palettes: Array<{ name: string; attribute: string; flags: string[]; prefersDark: boolean }> = [
  { name: ':root', attribute: '', flags: [], prefersDark: false },
  { name: 'prefers-color-scheme: dark', attribute: '', flags: ['--force-dark-mode'], prefersDark: true },
  { name: "[data-theme='dark']", attribute: ' data-theme="dark"', flags: [], prefersDark: false },
]

describe('revision marks against engine-rendered output', () => {
  for (const palette of palettes) {
    it(`pairs an insertion and a deletion to the palette in ${palette.name}`, async () => {
      const bin = chromeBin()
      expect(bin, 'Chrome is required to measure a computed style').toBeDefined()
      if (!bin) return
      if (!(await canDriveChrome(bin))) return

      const reading = await read(bin, palette.attribute, palette.flags)

      // Guard the control itself: without this, a flag that stopped reaching the
      // dark block would measure the light palette three times and pass.
      expect(reading.prefersDark, 'the palette this case meant to reach').toBe(palette.prefersDark)
      expect(reading.dataTheme).toBe(palette.attribute ? 'dark' : null)

      for (const kind of ['ins', 'del'] as const) {
        const measured = reading[kind]
        expect(measured.background, `${kind} fell back to the user agent`).not.toBe('rgba(0, 0, 0, 0)')
        expect(measured.color, `${kind} reads in the ink of plain text`).not.toBe(reading.plainInk)
        expect(measured.washAgainstPage, `${kind} wash is invisible on the paper`).toBeGreaterThan(MIN_WASH)
        expect(measured.contrast, `${kind} ink on its own wash`).toBeGreaterThanOrEqual(MIN_CONTRAST)
      }

      // And from each other, which a shared wash would satisfy none of the above for.
      expect(reading.ins.background).not.toBe(reading.del.background)
      expect(reading.ins.color).not.toBe(reading.del.color)
    })

    it(`drops a nested revision's fill inside a highlight in ${palette.name}`, async () => {
      const bin = chromeBin()
      expect(bin, 'Chrome is required to measure a computed style').toBeDefined()
      if (!bin) return
      if (!(await canDriveChrome(bin))) return

      const reading = await read(bin, palette.attribute, palette.flags)

      // markup-carve/carve-css#19: a second rectangle inside the highlight wash
      // breaks the one region a highlight claims, so the nested fill drops and
      // the decoration carries the signal instead.
      for (const kind of ['markIns', 'markDel'] as const) {
        expect(reading[kind].background, `${kind} still paints inside the highlight`).toBe('rgba(0, 0, 0, 0)')
        expect(reading[kind].color, `${kind} repaints over the highlight pair`).toBe(reading.mark.color)
        expect(reading[kind].decoration, `${kind} lost its only remaining signal`).not.toBe('none')
      }
      expect(reading.markIns.decoration).not.toBe(reading.markDel.decoration)
    })
  }
})
