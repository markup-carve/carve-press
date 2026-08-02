import { describe, it, expect } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { resolveConfig } from '../src/config.js'
import { BuildEventBus } from '../src/events.js'
import { llmsTxt } from '../src/extensions/llms-txt.js'
import type { LlmsTxtOptions } from '../src/extensions/llms-txt.js'
import type { RenderedPage } from '../src/render/page.js'

function renderedPage(route: string, title: string, description?: string): RenderedPage {
  return {
    page: {
      route,
      srcPath: resolve(import.meta.dirname, 'fixtures/site/start.crv'),
      relPath: 'start.crv',
      frontmatter: description === undefined ? { title } : { title, description },
      source: '# Page\n',
      bodyStartLine: 1,
    },
    html: '<h1>Page</h1>',
    outline: [],
    searchDoc: { route, title, headings: [], sections: [], text: '' },
  }
}

async function emitLlmsTxt(rendered: RenderedPage[], opts: LlmsTxtOptions = {}) {
  const outDir = await mkdtemp(resolve(tmpdir(), 'cp-llms-'))
  const bus = new BuildEventBus()
  llmsTxt(opts).setup(bus)
  await bus.emit('buildStarted', {
    config: resolveConfig({ title: 'Carve', description: 'Site summary', base: '/carve/' }),
  })
  await bus.emit('buildCompleted', { rendered, outDir })
  return outDir
}

describe('llmsTxt', () => {
  it('writes llms.txt on buildCompleted with title and one page line per page', async () => {
    const outDir = await emitLlmsTxt([
      renderedPage('/', 'Home', 'Start here'),
      renderedPage('/guide/', 'Guide', 'Read the guide'),
    ])
    const text = await readFile(resolve(outDir, 'llms.txt'), 'utf8')
    expect(text).toContain('# Carve\n')
    expect(text).toContain('> Site summary\n')
    expect(text).toContain('- [Home](/carve/): Start here')
    expect(text).toContain('- [Guide](/carve/guide/): Read the guide')
    expect(text.match(/^- \[/gm)).toHaveLength(2)
  })

  it('emits a well-formed page line when a page has no description', async () => {
    const outDir = await emitLlmsTxt([renderedPage('/api/', 'API')])
    const text = await readFile(resolve(outDir, 'llms.txt'), 'utf8')
    expect(text).toContain('- [API](/carve/api/)\n')
    expect(text).not.toContain('- [API](/carve/api/): undefined')
  })

  it('omits excluded routes', async () => {
    const outDir = await emitLlmsTxt(
      [renderedPage('/keep/', 'Keep', 'Visible'), renderedPage('/drop/', 'Drop', 'Hidden')],
      { exclude: ['/drop/'] },
    )
    const text = await readFile(resolve(outDir, 'llms.txt'), 'utf8')
    expect(text).toContain('- [Keep](/carve/keep/): Visible')
    expect(text).not.toContain('Drop')
  })

  it('honors filename, title, and summary options', async () => {
    const outDir = await emitLlmsTxt([renderedPage('/guide/', 'Guide', 'Docs')], {
      filename: 'ai/context.txt',
      title: 'Custom Title',
      summary: 'Custom summary',
    })
    const text = await readFile(resolve(outDir, 'ai/context.txt'), 'utf8')
    expect(text).toContain('# Custom Title\n')
    expect(text).toContain('> Custom summary\n')
    expect(text).toContain('- [Guide](/carve/guide/): Docs')
  })
})
