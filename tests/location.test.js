import { describe, it, expect, beforeAll } from 'vitest'

import { setup } from './harness.js'

// Location visits (409 + X-Inertia-Location): asset version mismatches and
// inertia_location redirects go to native instead of window.location.
describe('location visits', () => {
  let h
  let onError
  let headerKeptWithoutAdapter
  // Per-visit callbacks of the native visit in flight, if any.
  let native = null
  const visitCalls = []

  beforeAll(async () => {
    h = await setup()
    h.router.visit = (url, opts = {}) => visitCalls.push({ url: String(url), opts })
    const { http } = await import('@inertiajs/core')
    http.onError = (handler) => {
      onError = handler
    }
    h.initInertiaNative({ debug: false })

    // In a browser no adapter connects, so Inertia keeps the location visit.
    headerKeptWithoutAdapter = 'x-inertia-location' in locationResponse('/elsewhere').headers

    h.loadFixture('turbo.js')
    await h.tick()
  })

  // What Inertia does after its http client rejects a 409: run the error
  // handlers, then fire httpException if the header is gone.
  function locationResponse(location) {
    const response = { status: 409, data: '', headers: { 'x-inertia-location': location } }
    onError({ response })
    return response
  }

  // Inertia passes the same response object to the visit's onHttpException
  // and then to the httpException event. `from` is the visit that made the
  // request; null for a form or async visit.
  function respond(location, from = native) {
    const response = { ...locationResponse(location) }
    from?.onHttpException(response)
    return h.dispatchInertia('httpException', { response }, { cancelable: true })
  }

  async function nativeVisit(url) {
    window.Turbo.navigator.startVisit(url, null, { action: 'advance' })
    await h.tick()
    native = visitCalls.at(-1).opts
    native.onStart()
  }

  function stopNativeVisit() {
    window.Turbo.navigator.stop()
    native = null
  }

  function messages() {
    return h.turboMessages.map((m) => m.name)
  }

  it('leaves the location visit to Inertia without a native adapter', () => {
    expect(headerKeptWithoutAdapter).toBe(true)
  })

  it('invalidates a native visit redirected on the same origin', async () => {
    await nativeVisit('http://localhost:3000/b')
    h.turboMessages.length = 0
    const event = respond('http://localhost:3000/b')
    await h.tick()

    expect(event.defaultPrevented).toBe(true)
    expect(messages()).toContain('pageInvalidated')
    expect(messages()).not.toContain('visitRequestFailed')
  })

  it('fails a native visit redirected cross-origin so native resolves it', async () => {
    await nativeVisit('http://localhost:3000/map')
    h.turboMessages.length = 0
    const event = respond('https://maps.example.com/place')
    await h.tick()

    expect(event.defaultPrevented).toBe(true)
    const failed = h.turboMessages.find((m) => m.name === 'visitRequestFailedWithNonHttpStatusCode')
    // iOS drops this message without a statusCode.
    expect(failed?.data?.statusCode).toBe(0)
    expect(messages()).not.toContain('visitProposed')
  })

  it('proposes another location outside a native visit', async () => {
    stopNativeVisit()
    h.turboMessages.length = 0
    const event = respond('https://maps.example.com/place')
    await h.tick()

    expect(event.defaultPrevented).toBe(true)
    const proposed = h.turboMessages.find((m) => m.name === 'visitProposed')
    expect(proposed?.data?.location).toBe('https://maps.example.com/place')
  })

  // A form answered with `inertia_location '/recede_historical_location'` (the
  // server's recede_or_redirect_to): native's built-in rule for the path pops
  // the screen or dismisses the modal.
  it('proposes a historical location after a form', async () => {
    stopNativeVisit()
    h.turboMessages.length = 0
    const event = respond('/recede_historical_location')
    await h.tick()

    expect(event.defaultPrevented).toBe(true)
    expect(messages()).not.toContain('pageInvalidated')
    const proposed = h.turboMessages.find((m) => m.name === 'visitProposed')
    expect(proposed?.data?.location).toBe('http://localhost:3000/recede_historical_location')
  })

  it('invalidates the current page outside a native visit', async () => {
    stopNativeVisit()
    h.turboMessages.length = 0
    respond('/')
    await h.tick()

    expect(messages()).toContain('pageInvalidated')
    expect(messages()).not.toContain('visitProposed')
  })

  // A poll answered with an external location while a native visit is in
  // flight must not fail that visit.
  it('treats an async visit\'s location visit as outside the native visit', async () => {
    await nativeVisit('http://localhost:3000/b')
    h.turboMessages.length = 0
    respond('https://maps.example.com/place', null)
    await h.tick()

    expect(messages()).not.toContain('visitRequestFailedWithNonHttpStatusCode')
    expect(messages()).toContain('visitProposed')
  })

  it('leaves other 409s to the existing error handling', async () => {
    await nativeVisit('http://localhost:3000/b')
    h.turboMessages.length = 0
    const response = { status: 409, data: '', headers: {} }
    onError({ response })
    native.onHttpException(response)
    h.dispatchInertia('httpException', { response }, { cancelable: true })
    await h.tick()

    const failed = h.turboMessages.find((m) => m.name === 'visitRequestFailed')
    expect(failed?.data?.statusCode).toBe(409)
  })
})
