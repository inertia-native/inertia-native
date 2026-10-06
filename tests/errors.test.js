import { describe, it, expect, beforeAll } from 'vitest'

import { setup } from './harness.js'

// HTTP errors (httpException) and network failures (networkError) report the
// failure to native so it can show its error screen instead of hanging.
describe('error handling', () => {
  let h
  const visitCalls = []

  beforeAll(async () => {
    h = await setup()
    h.router.visit = (url, opts = {}) => visitCalls.push({ url: String(url), opts })
    h.initInertiaNative({ debug: false })
    h.loadFixture('turbo.js')
    await h.tick()
  })

  // Starts a native visit and returns the per-visit callbacks Inertia would run.
  async function nativeVisit(url) {
    window.Turbo.navigator.startVisit(url, null, { action: 'advance' })
    await h.tick()
    const callbacks = visitCalls.at(-1).opts
    callbacks.onStart()
    return callbacks
  }

  it('reports a 404 with its status code and suppresses the Inertia overlay', async () => {
    h.turboMessages.length = 0
    const visit = await nativeVisit('http://localhost:3000/not_found')
    const httpEvent = h.dispatchInertia('httpException', { response: { status: 404 } }, { cancelable: true })
    visit.onFinish()
    await h.tick()

    expect(httpEvent.defaultPrevented).toBe(true)
    const failed = h.turboMessages.find((m) => m.name === 'visitRequestFailed')
    expect(failed?.data?.statusCode).toBe(404)
  })

  it('invalidates the page on a 2xx response without X-Inertia', async () => {
    h.turboMessages.length = 0
    const visit = await nativeVisit('http://localhost:3000/legacy')
    const httpEvent = h.dispatchInertia(
      'httpException',
      { response: { status: 200, headers: {} } },
      { cancelable: true }
    )
    visit.onFinish()
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
    const visit = await nativeVisit('http://localhost:3000/navigation')
    h.dispatchInertia('networkError', { error: new Error('offline') }, { cancelable: true })
    visit.onFinish()
    await h.tick()

    expect(h.turboMessages.some((m) => m.name === 'visitRequestFailedWithNonHttpStatusCode')).toBe(true)
  })
})
