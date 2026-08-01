import { describe, it, expect } from 'vitest'
import { BuildEventBus } from '../src/events.js'
import { resolveConfig } from '../src/config.js'

describe('BuildEventBus', () => {
  it('calls handlers in registration order', async () => {
    const bus = new BuildEventBus()
    const seen: number[] = []
    bus.on('buildStarted', () => void seen.push(1))
    bus.on('buildStarted', () => void seen.push(2))
    await bus.emit('buildStarted', { config: resolveConfig({ title: 'x' }) })
    expect(seen).toEqual([1, 2])
  })

  it('returns the payload so mutations reach the caller', async () => {
    const bus = new BuildEventBus()
    bus.on('contentDiscovered', (p) => {
      p.pages = p.pages.filter((page) => page.route !== '/drop')
    })
    const out = await bus.emit('contentDiscovered', {
      pages: [{ route: '/keep' }, { route: '/drop' }] as never,
    })
    expect(out.pages.map((p) => p.route)).toEqual(['/keep'])
  })

  it('awaits async handlers before returning', async () => {
    const bus = new BuildEventBus()
    let done = false
    bus.on('buildStarted', async () => {
      await new Promise((r) => setTimeout(r, 5))
      done = true
    })
    await bus.emit('buildStarted', { config: resolveConfig({ title: 'x' }) })
    expect(done).toBe(true)
  })

  it('emitting an event with no handlers is a no-op', async () => {
    const bus = new BuildEventBus()
    const payload = { config: resolveConfig({ title: 'x' }) }
    expect(await bus.emit('buildStarted', payload)).toBe(payload)
  })

  it('surfaces a handler error with the extension name', async () => {
    const bus = new BuildEventBus()
    bus.on(
      'buildStarted',
      () => {
        throw new Error('boom')
      },
      'sitemap',
    )
    await expect(bus.emit('buildStarted', { config: resolveConfig({ title: 'x' }) })).rejects.toThrow(
      /extension "sitemap".*boom/s,
    )
  })
})
