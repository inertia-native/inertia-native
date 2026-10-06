import { describe, it, expect, beforeAll } from 'vitest'

import { setup } from './harness.js'

// A back/restore visit restores the page from Inertia's history cache
// (no request) when an entry exists, and falls back to a fresh request otherwise.
describe('restore', () => {
  let h
  const visitCalls = []
  let backRestores = true
  // Where history.back() lands, and whether that entry is an Inertia one.
  let landsOn = 'http://localhost:3000/'
  let landsOnInertiaEntry = true
  let backCalls = 0

  // The driver only steps back when Inertia has pushed an entry in this
  // document, so stand one up the way Inertia would.
  const pushEntry = () => globalThis.history.pushState({ page: {} }, '', '/pushed')

  beforeAll(async () => {
    h = await setup({ url: 'http://localhost:3000/navigation' })
    h.router.visit = (url, opts = {}) => visitCalls.push({ url: String(url), opts })
    // Simulate Inertia's quiet popstate restore landing on the previous page.
    globalThis.history.back = () => {
      backCalls += 1
      if (!backRestores) return
      globalThis.location = new URL(landsOn)
      // Inertia stamps its own entries with `state.page`; anything else (a
      // Hotwire bootstrap document, say) has no state at all.
      globalThis.history.state = landsOnInertiaEntry ? { page: { url: landsOn } } : null
      setTimeout(() => h.winEvents.dispatchEvent(new Event('popstate')), 5)
    }
    h.initHotwireNative({ debug: false })
    h.loadFixture('turbo.js')
    await h.tick()
  })

  it('restores from cache without a request', async () => {
    visitCalls.length = 0
    backRestores = true
    landsOn = 'http://localhost:3000/'
    landsOnInertiaEntry = true
    pushEntry()
    window.Turbo.navigator.startVisit('http://localhost:3000/', 'rest-1', { action: 'restore' })
    await h.tick(60)

    expect(visitCalls.length).toBe(0) // no server request
    const names = h.turboMessages.map((m) => m.name)
    expect(names).toContain('visitRequestStarted')
    expect(names).toContain('visitRequestCompleted')
    expect(names).toContain('visitRendered')
    expect(names).toContain('visitCompleted')
    expect(names).toContain('visitRequestFinished')
  })

  it('falls back to a request when there is no cached entry', async () => {
    visitCalls.length = 0
    backRestores = false
    pushEntry()
    window.Turbo.navigator.startVisit('http://localhost:3000/', 'rest-2', { action: 'restore' })
    await h.tick(350)

    expect(visitCalls[0].url).toBe('http://localhost:3000/')
    expect(visitCalls[0].opts.replace).toBe(true)
  })

  // Restoring the first web page in a native stack steps onto Hotwire's
  // bootstrap document: popstate fires, but no Inertia page is restored. The
  // 250ms fallback never runs, so without this check the visit is reported as
  // completed over a blank web view.
  it('requests the page when history.back() lands off-target', async () => {
    visitCalls.length = 0
    backRestores = true
    landsOn = 'http://localhost:3000/bootstrap'
    landsOnInertiaEntry = false
    pushEntry()
    const before = h.turboMessages.length
    window.Turbo.navigator.startVisit('http://localhost:3000/', 'rest-3', { action: 'restore' })
    await h.tick(60)

    expect(visitCalls.length).toBe(1)
    expect(visitCalls[0].url).toBe('http://localhost:3000/')
    // Nothing may be reported as rendered — the web view is showing the
    // bootstrap document, not the page.
    const names = h.turboMessages.slice(before).map((m) => m.name)
    expect(names).not.toContain('visitRendered')
    expect(names).not.toContain('visitCompleted')
  })

  // Landing on a real Inertia entry at a different URL is still a miss.
  it('requests the page when back() lands on another Inertia entry', async () => {
    visitCalls.length = 0
    backRestores = true
    landsOn = 'http://localhost:3000/elsewhere'
    landsOnInertiaEntry = true
    pushEntry()
    window.Turbo.navigator.startVisit('http://localhost:3000/', 'rest-4', { action: 'restore' })
    await h.tick(60)

    expect(visitCalls.length).toBe(1)
    expect(visitCalls[0].url).toBe('http://localhost:3000/')
  })

  // The blank screen happens at history.back() itself, before any handler can
  // react, so at the first entry the step must not be taken at all.
  it('never steps back when nothing of ours is behind', async () => {
    visitCalls.length = 0
    backRestores = true
    backCalls = 0
    // No pushEntry(): this is the first web page in the stack.
    const before = h.turboMessages.length
    window.Turbo.navigator.startVisit('http://localhost:3000/', 'rest-5', { action: 'restore' })
    await h.tick(60)

    expect(backCalls).toBe(0) // the web view never leaves the page
    expect(visitCalls.length).toBe(1)
    expect(visitCalls[0].url).toBe('http://localhost:3000/')
    const names = h.turboMessages.slice(before).map((m) => m.name)
    expect(names).not.toContain('visitRendered')
  })

  // Each restore consumes one pushed entry, so a second restore after a single
  // push is back at the bottom and must not step either.
  it('stops stepping back once the pushed entries are used up', async () => {
    backRestores = true
    landsOn = 'http://localhost:3000/'
    landsOnInertiaEntry = true
    pushEntry()

    window.Turbo.navigator.startVisit('http://localhost:3000/', 'rest-6', { action: 'restore' })
    await h.tick(60)

    visitCalls.length = 0
    backCalls = 0
    window.Turbo.navigator.startVisit('http://localhost:3000/', 'rest-7', { action: 'restore' })
    await h.tick(60)

    expect(backCalls).toBe(0)
    expect(visitCalls.length).toBe(1)
  })
})
