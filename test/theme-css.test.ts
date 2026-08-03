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
