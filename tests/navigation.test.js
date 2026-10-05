import { describe, it, expect, beforeAll } from 'vitest'

import { setup } from './harness.js'

// Link tap proposes a native visit; native requests it; the visit performs
// an Inertia router.visit and drives the native lifecycle. Plus back/restore.
describe('navigation', () => {
  let h
  const visitCalls = []

  beforeAll(async () => {
    h = await setup()
    h.router.visit = (url, opts = {}) => visitCalls.push({ url: String(url), opts })
    h.initHotwireNative({ debug: false })
    h.loadFixture('turbo.js')
    await h.tick()
  })

  it('proposes a native visit on link tap (no request yet)', async () => {
    const before = h.dispatchInertia(
      'before',
      { visit: { url: 'http://localhost:3000/navigation', method: 'get', replace: false } },
      { cancelable: true }
    )
    const proposed = h.turboMessages.find((m) => m.name === 'visitProposed')

    expect(before.defaultPrevented).toBe(true)
    expect(proposed?.data?.location).toBe('http://localhost:3000/navigation')
    expect(visitCalls.length).toBe(0)
  })

  // Partial reloads, polls, <WhenVisible>, <InfiniteScroll>, deferred props and
  // filters update the current page; they must not open a native screen.
  it.each([
    ['a partial reload', { only: ['users'] }],
    ['an except reload', { except: ['users'] }],
    ['a reset reload', { reset: ['users'] }],
    ['an async visit', { async: true }],
    ['a preserveState filter', { url: 'http://localhost:3000/?q=a', preserveState: true }],
    ['a preserveUrl visit', { url: 'http://localhost:3000/?page=2', preserveUrl: true }],
    ['a visit to the current URL', { url: 'http://localhost:3000/#top' }],
  ])('lets %s run in the web view', (_name, options) => {
    window.Turbo.navigator.stop() // no native visit in flight
    h.turboMessages.length = 0
    const before = h.dispatchInertia(
      'before',
      { visit: { url: 'http://localhost:3000/users', method: 'get', only: [], except: [], reset: [], ...options } },
      { cancelable: true }
    )

    expect(before.defaultPrevented).toBe(false)
    expect(h.turboMessages.map((m) => m.name)).not.toContain('visitProposed')
  })

  it('cancels a prefetch without proposing a visit', () => {
    window.Turbo.navigator.stop()
    h.turboMessages.length = 0
    const before = h.dispatchInertia(
      'before',
      { visit: { url: 'http://localhost:3000/navigation', method: 'get', prefetch: true, async: true } },
      { cancelable: true }
    )

    expect(before.defaultPrevented).toBe(true)
    expect(h.turboMessages.map((m) => m.name)).not.toContain('visitProposed')
  })

  it('performs the visit and drives the lifecycle when native requests it', async () => {
    window.Turbo.navigator.startVisit('http://localhost:3000/navigation', 'rest-1', { action: 'advance' })
    await h.tick()

    expect(h.turboMessages.some((m) => m.name === 'visitStarted')).toBe(true)
    expect(visitCalls[0].url).toBe('http://localhost:3000/navigation')
    expect(visitCalls[0].opts.replace).toBe(false)

    h.dispatchInertia('start', { visit: { url: 'http://localhost:3000/navigation', method: 'get' } })
    h.dispatchInertia('success', { page: {} })
    h.dispatchInertia('finish', { visit: { url: 'http://localhost:3000/navigation', method: 'get' } })
    await h.tick(20)

    const names = h.turboMessages.map((m) => m.name)
    expect(names).toContain('visitRequestStarted')
    expect(names).toContain('visitRequestCompleted')
    expect(names).toContain('visitRendered')
    expect(names).toContain('visitCompleted')
    expect(names).toContain('visitRequestFinished')
  })

  it('does not crash on back/restore and replaces history', async () => {
    visitCalls.length = 0
    expect(() =>
      window.Turbo.navigator.startVisit('http://localhost:3000/', 'rest-2', { action: 'restore' })
    ).not.toThrow()
    await h.tick(300) // restore falls back to a request (no real history entry here)

    expect(visitCalls[0].url).toBe('http://localhost:3000/')
    expect(visitCalls[0].opts.replace).toBe(true)
  })
})
