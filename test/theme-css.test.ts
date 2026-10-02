import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

async function mobileBlock(): Promise<string> {
  const css = await readFile(resolve(import.meta.dirname, '../theme/default.css'), 'utf8')
  const start = css.indexOf('@media (max-width: 820px)')
  expect(start).toBeGreaterThan(-1)
  // Up to the next top-level media query, which is where the mobile rules end.
  const next = css.indexOf('\n@media', start + 1)
  return css.slice(start, next === -1 ? undefined : next)
}

function zIndexAfter(block: string, selector: string): number {
  const at = block.indexOf(selector)
  expect(at, `selector ${selector} not found in the mobile block`).toBeGreaterThan(-1)
  const match = /z-index:\s*(\d+)/.exec(block.slice(at))
  expect(match, `no z-index found for ${selector}`).not.toBeNull()
  return Number(match![1])
}

/**
 * The drawer bug this pins: `.site-nav` is nested inside `.site-header`, which
 * is a stacking context at mobile widths, so the drawer can never paint above
 * the header's own z-index however high its own is. With the header below the
 * scrim, the scrim covered every link in the open menu and a tap closed the
 * menu instead of following the link.
 */
describe('mobile drawer stacking', () => {
  it('keeps the header above the scrim, because the nav drawer lives inside it', async () => {
    const block = await mobileBlock()

    expect(zIndexAfter(block, '.site-header {')).toBeGreaterThan(zIndexAfter(block, '.drawer-scrim {'))
  })

  it('keeps the drawers themselves above the scrim', async () => {
    const block = await mobileBlock()

    expect(zIndexAfter(block, '.site-nav,\n  .sidebar {')).toBeGreaterThan(
      zIndexAfter(block, '.drawer-scrim {'),
    )
  })
})

async function css(): Promise<string> {
  return readFile(resolve(import.meta.dirname, '../theme/default.css'), 'utf8')
}

/**
 * The engine emits every radio with its own label beside it, then ALL the
 * panels, so no panel is ever adjacent to its label. Measured in Chromium,
 * Firefox and WebKit against this generator's own output: with radio N checked,
 * panel N is the only one whose computed display is not none; a nested set
 * reveals no panel of the set around it; and a 15-tab set shows every panel
 * rather than none once the reader leaves the ladder's range.
 */
describe('tab set styling', () => {
  it('pairs each radio with its panel positionally across the general sibling combinator', async () => {
    const text = await css()

    for (let n = 1; n <= 12; n++) {
      expect(text).toContain(`.tabs-radio:nth-of-type(${n}):checked ~ .tabs-panel:nth-of-type(${n})`)
    }
    // :has() takes a descendant, so it makes a nested set reveal a panel of its parent.
    expect(text).not.toMatch(/\.tabs[\w-]*:has\(/)
    // The element after a label is the next radio, never the panel.
    expect(text).not.toContain('.tabs-label + .tabs-panel')
  })

  it('shows every panel past the ladder, so a long set degrades instead of going blank', async () => {
    expect(await css()).toContain('.tabs-radio:nth-of-type(n + 13):checked ~ .tabs-panel')
  })

  it('keys hiding on :checked, so a set with nothing checked still shows its panels', async () => {
    const text = await css()

    expect(text).toContain('.tabs-radio:checked ~ .tabs-panel { display: none; }')
    expect(text).not.toMatch(/^\.tabs-panel \{[^}]*display:\s*none/m)
  })

  it('themes mark, and lets a link or revision mark inside it keep the highlight ink', async () => {
    const text = await css()

    expect(text).toMatch(/^mark \{[\s\S]*?background: var\(--highlight\);/m)
    expect(text).toMatch(/^mark \{[\s\S]*?color: var\(--highlight-ink\);/m)
    expect(text).toMatch(/mark a,\nmark del,\nmark ins \{ color: inherit; \}/)
    for (const block of ['--highlight:', '--highlight-ink:']) {
      // Light, the prefers-color-scheme dark block, and the explicit dark attribute.
      expect(text.split(block).length - 1).toBe(3)
    }
  })

  // The computed-style and contrast reading lives in theme-revision-client.test.ts,
  // which needs Chrome. This half holds the token coverage, which is the way the
  // highlight fix nearly shipped half done: a pair defined in one palette block
  // leaves the other two on the user agent.
  it('defines the insertion and deletion pair in all three palette blocks', async () => {
    const text = await css()

    for (const token of ['--insert:', '--insert-ink:', '--delete:', '--delete-ink:']) {
      expect(text.split(token).length - 1, `${token} is missing from a palette block`).toBe(3)
    }
    expect(text).toMatch(/^ins \{\n  background: var\(--insert\);\n  color: var\(--insert-ink\);/m)
    expect(text).toMatch(/^del \{\n  background: var\(--delete\);\n  color: var\(--delete-ink\);/m)
  })
})
