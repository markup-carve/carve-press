import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { carveToHtml, mathBlock, spoiler } from '@markup-carve/carve'
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

type Box = {
  background: string
  borderLeftWidth: string
  paddingLeft: string
}

type MathBox = {
  display: string
  textAlign: string
  overflowX: string
}

type Reading = {
  prefersDark: boolean
  dataTheme: string | null
  inlineHidden: string
  inlineFocused: string
  inlineAfterBlur: string
  inlineRevealed: string
  inlineBox: Box
  detailsBox: Box
  sectionBox: Box
  sectionRevealedFilter: string
  divBox: Box
  divBodyHidden: string
  divTitle: string
  printInline: string
  inlineFontSize: string
  smallFontSize: string
  smallHidden: string
  mathInlineDisplay: string
  mathDisplaySpan: MathBox
  mathDisplayDiv: MathBox
}

const SOURCE = [
  'Plot: :spoiler[the butler did it] with $`x^2` and $$`y = 1`.',
  '',
  '::: spoiler "Ending"',
  'Everyone lives.',
  ':::',
  '',
  '``` math',
  'a + b',
  '```',
  '',
].join('\n')

/**
 * Three renders of one source, because the spoiler class rides four different
 * elements and no single mode produces them all: interactive gives the span and
 * the `<details>`, static gives the `spoiler-revealed` span and the `<section>`,
 * and dropping the extension gives the `<div>` fallback a host still has to
 * style. Hand-written HTML would stop matching the moment the engine moved.
 */
function renderAll(): string {
  const extensions = [spoiler(), mathBlock()]
  return [
    `<div id="interactive">${carveToHtml(SOURCE, { extensions })}</div>`,
    `<div id="static">${carveToHtml(SOURCE, { extensions, mode: 'static' })}</div>`,
    `<div id="bare">${carveToHtml(SOURCE)}</div>`,
    // The same source again inside the theme's own small print. `figcaption` is
    // 0.8rem, so an `em` radius here has to come out smaller than in body text;
    // a `rem` radius would come out identical.
    `<figure id="small"><figcaption>${carveToHtml(SOURCE, { extensions })}</figcaption></figure>`,
  ].join('\n')
}

function fixtureHtml(css: string, rendered: string, themeAttribute: string): string {
  return `<!doctype html>
<html${themeAttribute}>
<head><meta charset="utf-8"><style id="theme">
${css}
</style></head>
<body><main class="content">${rendered}</main>
<script>
  const pick = (selector) => {
    const el = document.querySelector(selector)
    if (!el) throw new Error('nothing matched ' + selector)
    return el
  }
  const filterOf = (selector) => getComputedStyle(pick(selector)).filter
  const box = (selector) => {
    const style = getComputedStyle(pick(selector))
    return {
      background: style.backgroundColor,
      borderLeftWidth: style.borderLeftWidth,
      paddingLeft: style.paddingLeft,
    }
  }
  const mathBox = (selector) => {
    const style = getComputedStyle(pick(selector))
    return { display: style.display, textAlign: style.textAlign, overflowX: style.overflowX }
  }

  // The reveal is one declaration block behind :is(:hover, :focus-within).
  // Headless Chrome cannot hover without a driver, so the measurement goes
  // through the focus arm, which needs the tabindex the stylesheet comment
  // names as the inline form's limit: the host has to add it.
  const hidden = pick('#interactive .spoiler')
  const beforeFocus = getComputedStyle(hidden).filter
  hidden.setAttribute('tabindex', '0')
  hidden.focus()
  const focused = getComputedStyle(hidden).filter
  hidden.blur()
  const afterBlur = getComputedStyle(hidden).filter
  hidden.removeAttribute('tabindex')

  // Print cannot be emulated through --dump-dom either, so the print block's own
  // declarations are re-applied under media: all and measured. That still proves
  // the rule exists AND outranks the blur in the cascade, which is the part a
  // maintainer gets wrong.
  let printInline = 'no print block found'
  const sheet = document.getElementById('theme').sheet
  for (const rule of sheet.cssRules) {
    if (rule.media && rule.conditionText === 'print') {
      const forced = document.createElement('style')
      forced.textContent = [...rule.cssRules].map((inner) => inner.cssText).join('\\n')
      document.head.append(forced)
      printInline = getComputedStyle(pick('#interactive .spoiler')).filter
      forced.remove()
    }
  }

  const node = document.createElement('pre')
  node.id = 'result'
  try {
    node.textContent = JSON.stringify({
      prefersDark: matchMedia('(prefers-color-scheme: dark)').matches,
      dataTheme: document.documentElement.getAttribute('data-theme'),
      inlineHidden: beforeFocus,
      inlineFocused: focused,
      inlineAfterBlur: afterBlur,
      inlineRevealed: filterOf('#static span.spoiler'),
      inlineBox: box('#interactive .spoiler'),
      detailsBox: box('#interactive details.spoiler'),
      sectionBox: box('#static section.spoiler'),
      sectionRevealedFilter: filterOf('#static section.spoiler'),
      divBox: box('#bare div.spoiler'),
      divBodyHidden: filterOf('#bare div.spoiler > p:not(.admonition-title)'),
      divTitle: filterOf('#bare div.spoiler > .admonition-title'),
      printInline,
      inlineFontSize: getComputedStyle(pick('#interactive .spoiler')).fontSize,
      smallFontSize: getComputedStyle(pick('#small span.spoiler')).fontSize,
      smallHidden: filterOf('#small span.spoiler'),
      mathInlineDisplay: getComputedStyle(pick('#interactive span.math.inline')).display,
      mathDisplaySpan: mathBox('#interactive span.math.display'),
      mathDisplayDiv: mathBox('#interactive div.math.display'),
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
  const userDataDir = await mkdtemp(resolve(tmpdir(), 'cp-chrome-'))
  const fixtureDir = await mkdtemp(resolve(tmpdir(), 'cp-spoiler-'))
  const htmlPath = resolve(fixtureDir, 'index.html')
  try {
    await writeFile(htmlPath, fixtureHtml(css, renderAll(), themeAttribute))
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

describe('spoiler and math against engine-rendered output', () => {
  for (const palette of palettes) {
    it(`obscures a spoiler and reveals it on demand in ${palette.name}`, async () => {
      const bin = chromeBin()
      expect(bin, 'Chrome is required to measure a computed style').toBeDefined()
      if (!bin) return
      if (!(await canDriveChrome(bin))) return

      const reading = await read(bin, palette.attribute, palette.flags)

      // Guard the control itself: without this, a flag that stopped reaching the
      // dark block would measure the light palette three times and pass.
      expect(reading.prefersDark, 'the palette this case meant to reach').toBe(palette.prefersDark)
      expect(reading.dataTheme).toBe(palette.attribute ? 'dark' : null)

      expect(reading.inlineHidden, 'an inline spoiler reaches the page unobscured').toMatch(/^blur\(/)

      // The radius is `em`, so it is a proportion of the text it hides rather
      // than one absolute value for the whole page. Measuring two sizes is what
      // a revert to `rem` would fail: there both readings would be equal.
      const px = (value: string, what: string): number => {
        const match = /^blur\(([\d.]+)px\)$/.exec(value)
        expect(match, `${what} is not a pixel blur: ${value}`).not.toBeNull()
        return Number(match![1])
      }
      const bodySize = Number.parseFloat(reading.inlineFontSize)
      const smallSize = Number.parseFloat(reading.smallFontSize)
      expect(smallSize, 'the small-print fixture is not smaller than body text').toBeLessThan(bodySize)
      const bodyRadius = px(reading.inlineHidden, 'the body-text blur')
      const smallRadius = px(reading.smallHidden, 'the small-print blur')
      expect(
        smallRadius,
        'the blur does not scale with its text: a spoiler in small print blurs by the same absolute radius as one in body text',
      ).toBeLessThan(bodyRadius)
      expect(bodyRadius / bodySize, 'the body-text blur is not 0.25em').toBeCloseTo(0.25, 3)
      expect(smallRadius / smallSize, 'the small-print blur is not 0.25em').toBeCloseTo(0.25, 3)
      expect(reading.inlineFocused, 'the spoiler never reveals').toBe('none')
      expect(reading.inlineAfterBlur, 'the reveal is permanent once triggered').toMatch(/^blur\(/)
      expect(reading.inlineRevealed, 'static render blurs content it meant to show').toBe('none')
      expect(reading.sectionRevealedFilter, 'the revealed block form is blurred').toBe('none')
      expect(reading.printInline, 'a blur on paper cannot be revealed').toBe('none')
    }, 90000)

    it(`boxes the block spoiler on every carrier and leaves the span inline in ${palette.name}`, async () => {
      const bin = chromeBin()
      expect(bin, 'Chrome is required to measure a computed style').toBeDefined()
      if (!bin) return
      if (!(await canDriveChrome(bin))) return

      const reading = await read(bin, palette.attribute, palette.flags)
      expect(reading.prefersDark, 'the palette this case meant to reach').toBe(palette.prefersDark)

      for (const carrier of ['detailsBox', 'sectionBox', 'divBox'] as const) {
        const measured = reading[carrier]
        expect(measured.background, `${carrier} has no panel surface`).not.toBe('rgba(0, 0, 0, 0)')
        expect(measured.borderLeftWidth, `${carrier} has no panel edge`).toBe('3px')
      }

      // carve-css#25: keyed on the class alone, the box lands on a word mid-sentence.
      expect(reading.inlineBox.background, 'the inline form took the block panel').toBe('rgba(0, 0, 0, 0)')
      expect(reading.inlineBox.paddingLeft, 'the inline form took the block padding').toBe('0px')

      // The extension-less div has no native disclosure, so its body is the part
      // that hides; its title has to stay legible or nothing names the widget.
      expect(reading.divBodyHidden, 'the fallback div shows its content plainly').toMatch(/^blur\(/)
      expect(reading.divTitle, 'the fallback div blurred its own label').toBe('none')
    }, 90000)

    it(`blocks out display math on both carriers and leaves inline math alone in ${palette.name}`, async () => {
      const bin = chromeBin()
      expect(bin, 'Chrome is required to measure a computed style').toBeDefined()
      if (!bin) return
      if (!(await canDriveChrome(bin))) return

      const reading = await read(bin, palette.attribute, palette.flags)
      expect(reading.prefersDark, 'the palette this case meant to reach').toBe(palette.prefersDark)

      expect(reading.mathInlineDisplay, 'inline math stopped sitting in the line').toBe('inline')
      for (const carrier of ['mathDisplaySpan', 'mathDisplayDiv'] as const) {
        const measured = reading[carrier]
        expect(measured.display, `${carrier} is not laid out as a block`).toBe('block')
        expect(measured.textAlign, `${carrier} is not centered`).toBe('center')
        expect(measured.overflowX, `${carrier} would clip a wide formula`).toBe('auto')
      }
    }, 90000)
  }
})
