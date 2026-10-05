import { describe, it, expect, beforeAll } from 'vitest'

import { setup } from './harness.js'

// Location visits (409 + X-Inertia-Location): asset version mismatches and
// inertia_location redirects go to native instead of window.location.
describe('location visits', () => {
  let h
  let onError
  let headerKeptWithoutAdapter

  beforeAll(async () => {
    h = await setup()
    h.router.visit = () => {} // lifecycle is driven manually below
    const { http } = await import('@inertiajs/core')
    http.onError = (handler) => {
      onError = handler
    }
    h.initHotwireNative({ debug: false })

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

  function respond(location) {
    const response = locationResponse(location)
    return h.dispatchInertia('httpException', { response: { ...response } }, { cancelable: true })
  }

  function nativeVisit(url) {
    window.Turbo.navigator.startVisit(url, null, { action: 'advance' })
    h.dispatchInertia('start', { visit: { method: 'get' } })
  }

  function messages() {
    return h.turboMessages.map((m) => m.name)
  }

  it('leaves the location visit to Inertia without a native adapter', () => {
    expect(headerKeptWithoutAdapter).toBe(true)
  })

  it('invalidates a native visit redirected on the same origin', async () => {
    nativeVisit('http://localhost:3000/b')
    h.turboMessages.length = 0
    const event = respond('http://localhost:3000/b')
    await h.tick()

    expect(event.defaultPrevented).toBe(true)
    expect(messages()).toContain('pageInvalidated')
    expect(messages()).not.toContain('visitRequestFailed')
  })

  it('fails a native visit redirected cross-origin so native resolves it', async () => {
    nativeVisit('http://localhost:3000/map')
    h.turboMessages.length = 0
    const event = respond('https://maps.example.com/place')
    await h.tick()

    expect(event.defaultPrevented).toBe(true)
    expect(messages()).toContain('visitRequestFailedWithNonHttpStatusCode')
    expect(messages()).not.toContain('visitProposed')
  })

  it('proposes another location outside a native visit', async () => {
    window.Turbo.navigator.stop()
    h.turboMessages.length = 0
    const event = respond('https://maps.example.com/place')
    await h.tick()

    expect(event.defaultPrevented).toBe(true)
    const proposed = h.turboMessages.find((m) => m.name === 'visitProposed')
    expect(proposed?.data?.location).toBe('https://maps.example.com/place')
  })

  it('invalidates the current page outside a native visit', async () => {
    window.Turbo.navigator.stop()
    h.turboMessages.length = 0
    respond('/')
    await h.tick()

    expect(messages()).toContain('pageInvalidated')
    expect(messages()).not.toContain('visitProposed')
  })

  it('leaves other 409s to the existing error handling', async () => {
    nativeVisit('http://localhost:3000/b')
    h.turboMessages.length = 0
    const response = { status: 409, data: '', headers: {} }
    onError({ response })
    h.dispatchInertia('httpException', { response }, { cancelable: true })
    await h.tick()

    const failed = h.turboMessages.find((m) => m.name === 'visitRequestFailed')
    expect(failed?.data?.statusCode).toBe(409)
  })
})
