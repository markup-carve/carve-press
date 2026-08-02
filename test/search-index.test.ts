import { describe, it, expect } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { BuildEventBus } from '../src/events.js'
import { searchIndex, type SearchIndexPayload } from '../src/extensions/search-index.js'
import type { Page } from '../src/content/discover.js'
import { renderPage, type RenderedPage } from '../src/render/page.js'

const ctx = {
  extensions: [],
  outlineLevels: [2, 3] as [number, number],
  includeRoots: [resolve(import.meta.dirname, 'fixtures')],
}

function page(source: string, route = '/p'): Page {
  return {
    route,
    srcPath: resolve(import.meta.dirname, 'fixtures/site/start.crv'),
    relPath: 'start.crv',
    frontmatter: { title: 'Start' },
    source,
    bodyStartLine: 4,
  }
}

async function emitIndex(rendered: RenderedPage[], opts = {}) {
  const outDir = await mkdtemp(resolve(tmpdir(), 'cp-search-'))
  const bus = new BuildEventBus()
  searchIndex(opts).setup(bus)
  await bus.emit('buildCompleted', { rendered, outDir })
  const json = await readFile(resolve(outDir, 'assets/search-index.json'), 'utf8')
  return JSON.parse(json) as SearchIndexPayload
}

describe('searchIndex', () => {
  it('writes the index file on buildCompleted', async () => {
    const rendered = renderPage(page('# T\n\n## Install\n\nRun it.\n'), ctx)
    const payload = await emitIndex([rendered])
    expect(payload.version).toBe(1)
    expect(payload.records).toHaveLength(1)
  })

  it('emits section records with resolvable anchors and no fenced-code text', async () => {
    const rendered = renderPage(
      page('# T\n\n## Install\n\nRun `carve`.\n\n```js\nconst needle = 1\n```\n\n### Options\n\nUse flags.\n'),
      ctx,
    )
    const payload = await emitIndex([rendered])
    expect(payload.records).toEqual([
      {
        id: '/p#Install:0',
        route: '/p',
        title: 'Start',
        heading: 'Install',
        slug: 'Install',
        text: 'Run carve. Use flags.',
      },
      {
        id: '/p#Options:1',
        route: '/p',
        title: 'Start',
        heading: 'Options',
        slug: 'Options',
        text: 'Use flags.',
      },
    ])
    expect(payload.records[0]?.text).not.toContain('needle')
  })

  it('omits excluded routes', async () => {
    const keep = renderPage(page('# T\n\n## Keep\n\nvisible\n', '/keep'), ctx)
    const drop = renderPage(page('# T\n\n## Drop\n\nhidden\n', '/drop'), ctx)
    const payload = await emitIndex([keep, drop], { exclude: ['/drop'] })
    expect(payload.records.map((record) => record.route)).toEqual(['/keep'])
  })
})
