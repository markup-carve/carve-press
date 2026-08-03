import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { resolveConfig } from '../src/config.js'
import { mapStaticRequest, startStaticServer } from '../src/server.js'

async function outDir(): Promise<string> {
  const dir = await mkdtemp(resolve(tmpdir(), 'cp-server-'))
  await mkdir(resolve(dir, 'foo'), { recursive: true })
  await writeFile(resolve(dir, 'index.html'), '<h1>Home</h1>')
  await writeFile(resolve(dir, 'foo/index.html'), '<h1>Foo</h1>')
  await writeFile(resolve(dir, '404.html'), '<h1>Missing</h1>')
  await writeFile(resolve(dir, 'style.css'), 'body {}\n')
  return dir
}

describe('mapStaticRequest', () => {
  it('serves clean URLs and content types', async () => {
    const dir = await outDir()
    const html = await mapStaticRequest('GET', '/foo', dir, { cleanUrls: true })
    const css = await mapStaticRequest('GET', '/style.css', dir, { cleanUrls: true })

    expect(html.status).toBe(200)
    expect(Buffer.from(html.body).toString('utf8')).toContain('<h1>Foo</h1>')
    expect(html.headers['Content-Type']).toBe('text/html; charset=utf-8')
    expect(css.headers['Content-Type']).toBe('text/css; charset=utf-8')
  })

  it('serves 404.html with 404 status for unknown paths', async () => {
    const dir = await outDir()
    const response = await mapStaticRequest('GET', '/missing', dir, { cleanUrls: true })

    expect(response.status).toBe(404)
    expect(Buffer.from(response.body).toString('utf8')).toContain('<h1>Missing</h1>')
  })

  it('does not serve paths outside outDir', async () => {
    const dir = await outDir()
    await writeFile(resolve(dir, '../secret.txt'), 'secret')

    const response = await mapStaticRequest('GET', '/../secret.txt', dir, { cleanUrls: true })

    expect(response.status).toBe(404)
    expect(Buffer.from(response.body).toString('utf8')).not.toContain('secret')
  })

  it('serves a site configured with a base under that base', async () => {
    const dir = await outDir()
    const options = { cleanUrls: true, base: '/carve-press/' }

    const page = await mapStaticRequest('GET', '/carve-press/foo', dir, options)
    const asset = await mapStaticRequest('GET', '/carve-press/style.css', dir, options)
    const unbased = await mapStaticRequest('GET', '/foo', dir, options)
    const root = await mapStaticRequest('GET', '/', dir, options)

    expect(page.status).toBe(200)
    expect(Buffer.from(page.body).toString('utf8')).toContain('<h1>Foo</h1>')
    expect(asset.status).toBe(200)
    // Outside the base is not the site: the deployed host would not serve it.
    expect(unbased.status).toBe(404)
    expect(root.status).toBe(302)
    expect(root.headers.Location).toBe('/carve-press/')
  })

  it('injects live reload only when requested for HTML', async () => {
    const dir = await outDir()
    const staticHtml = await mapStaticRequest('GET', '/', dir, { cleanUrls: true })
    const devHtml = await mapStaticRequest('GET', '/', dir, { cleanUrls: true, injectHtml: true })

    expect(Buffer.from(staticHtml.body).toString('utf8')).not.toContain('__carve_press_events')
    expect(Buffer.from(devHtml.body).toString('utf8')).toContain('__carve_press_events')
  })
})

describe('startStaticServer', () => {
  it('serves a page and a 404 over an ephemeral port', async () => {
    const dir = await outDir()
    const server = await startStaticServer({
      outDir: dir,
      config: resolveConfig({ title: 'Test' }),
      port: 0,
      host: '127.0.0.1',
    })

    try {
      const page = await fetch(`${server.url}/foo`)
      const missing = await fetch(`${server.url}/missing`)

      expect(page.status).toBe(200)
      expect(await page.text()).toContain('<h1>Foo</h1>')
      expect(missing.status).toBe(404)
      expect(await missing.text()).toContain('<h1>Missing</h1>')
    } finally {
      await server.close()
    }
  })
})
