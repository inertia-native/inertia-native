import { describe, it, expect, beforeAll } from 'vitest'

import { setup } from './harness.js'

// HTTP errors (httpException) and network failures (networkError) report the
// failure to native so it can show its error screen instead of hanging.
describe('error handling', () => {
  let h

  beforeAll(async () => {
    h = await setup()
    h.router.visit = () => {} // lifecycle is driven manually below
    h.initHotwireNative({ debug: false })
    h.loadFixture('turbo.js')
    await h.tick()
  })

  function nativeVisit(url) {
    window.Turbo.navigator.startVisit(url, null, { action: 'advance' })
  }

  it('reports a 404 with its status code and suppresses the Inertia overlay', async () => {
    h.turboMessages.length = 0
    nativeVisit('http://localhost:3000/not_found')
    h.dispatchInertia('start', { visit: {} })
    const httpEvent = h.dispatchInertia('httpException', { response: { status: 404 } }, { cancelable: true })
    h.dispatchInertia('finish', { visit: {} })
    await h.tick()

    expect(httpEvent.defaultPrevented).toBe(true)
    const failed = h.turboMessages.find((m) => m.name === 'visitRequestFailed')
    expect(failed?.data?.statusCode).toBe(404)
  })

  it('invalidates the page on a 2xx response without X-Inertia', async () => {
    h.turboMessages.length = 0
    nativeVisit('http://localhost:3000/legacy')
    h.dispatchInertia('start', { visit: {} })
    const httpEvent = h.dispatchInertia(
      'httpException',
      { response: { status: 200, headers: {} } },
      { cancelable: true }
    )
    h.dispatchInertia('finish', { visit: {} })
    await h.tick()

    expect(httpEvent.defaultPrevented).toBe(true)
    const names = h.turboMessages.map((m) => m.name)
    expect(names).toContain('pageInvalidated')
    expect(names).not.toContain('visitRequestFailed')
  })

  // Forms don't run through a native visit; reloading would land on the
  // screen's old URL rather than the submission's result.
  it('leaves a non-Inertia response to a form alone', async () => {
    window.Turbo.navigator.stop() // no native visit in flight
    h.turboMessages.length = 0
    const httpEvent = h.dispatchInertia(
      'httpException',
      { response: { status: 200, headers: {} } },
      { cancelable: true }
    )
    await h.tick()

    expect(httpEvent.defaultPrevented).toBe(false)
    expect(h.turboMessages.map((m) => m.name)).not.toContain('pageInvalidated')
  })

  it('routes a network failure as a non-HTTP failure', async () => {
    h.turboMessages.length = 0
    nativeVisit('http://localhost:3000/navigation')
    h.dispatchInertia('start', { visit: {} })
    h.dispatchInertia('networkError', { error: new Error('offline') }, { cancelable: true })
    h.dispatchInertia('finish', { visit: {} })
    await h.tick()

    expect(h.turboMessages.some((m) => m.name === 'visitRequestFailedWithNonHttpStatusCode')).toBe(true)
  })

  // @inertiajs/core <3.4 fires `invalid`/`exception` instead of
  // `httpException`/`networkError`. The driver listens for both so error
  // screens keep working across the whole declared peer range.
  it('reports a 404 from the legacy `invalid` event', async () => {
    h.turboMessages.length = 0
    nativeVisit('http://localhost:3000/not_found')
    h.dispatchInertia('start', { visit: {} })
    const invalidEvent = h.dispatchInertia('invalid', { response: { status: 404 } }, { cancelable: true })
    h.dispatchInertia('finish', { visit: {} })
    await h.tick()

    expect(invalidEvent.defaultPrevented).toBe(true)
    const failed = h.turboMessages.find((m) => m.name === 'visitRequestFailed')
    expect(failed?.data?.statusCode).toBe(404)
  })

  it('routes the legacy `exception` event as a non-HTTP failure', async () => {
    h.turboMessages.length = 0
    nativeVisit('http://localhost:3000/navigation')
    h.dispatchInertia('start', { visit: {} })
    h.dispatchInertia('exception', { exception: new Error('offline') }, { cancelable: true })
    h.dispatchInertia('finish', { visit: {} })
    await h.tick()

    expect(h.turboMessages.some((m) => m.name === 'visitRequestFailedWithNonHttpStatusCode')).toBe(true)
  })
})
