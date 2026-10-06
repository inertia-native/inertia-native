import { describe, it, expect } from 'vitest'

import { setup } from './harness.js'

// The web side installs window.Turbo; the injected native turbo.js connects
// its adapter and gets pageLoaded with a restoration identifier.
describe('handshake', () => {
  it('installs window.Turbo and connects the native adapter', async () => {
    const h = await setup()
    h.initInertiaNative({ debug: false })

    expect(window.Turbo).toBeTruthy()

    // Native turbo.js runs; window.Turbo already exists so it registers now.
    h.loadFixture('turbo.js')
    await h.tick(40)

    expect(window.Turbo.session.adapter).toBeTruthy()

    const ready = h.turboMessages.find((m) => m.name === 'turboIsReady')
    expect(ready?.data?.isReady).toBe(true)

    const pageLoaded = h.turboMessages.find((m) => m.name === 'pageLoaded')
    expect(pageLoaded).toBeTruthy()
    expect(typeof pageLoaded.data.restorationIdentifier).toBe('string')
    expect(pageLoaded.data.restorationIdentifier.length).toBeGreaterThan(0)
  })

  it('keeps initHotwireNative as an alias', async () => {
    const mod = await import('../src/index.js')
    expect(mod.initHotwireNative).toBe(mod.initInertiaNative)
  })

  // A second init (HMR, double import, StrictMode) must not register a second
  // driver — otherwise every Inertia event would report to native twice.
  it('is idempotent: a repeat call does not duplicate native messages', async () => {
    const h = await setup()
    h.initInertiaNative({ debug: false })
    const shim = window.Turbo

    h.initInertiaNative({ debug: false })
    // Same shim object: the repeat call bailed instead of reinstalling.
    expect(window.Turbo).toBe(shim)

    h.loadFixture('turbo.js')
    await h.tick(40)

    // One driver → one native-side proposal per Inertia navigation.
    h.turboMessages.length = 0
    const before = h.dispatchInertia(
      'before',
      { visit: { url: '/next', method: 'get', replace: false } },
      { cancelable: true }
    )
    await h.tick()

    expect(before.defaultPrevented).toBe(true)
    const proposed = h.turboMessages.filter((m) => m.name === 'visitProposed')
    expect(proposed.length).toBe(1)
  })
})
