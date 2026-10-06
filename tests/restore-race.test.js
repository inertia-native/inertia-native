import { describe, it, expect, beforeAll } from 'vitest'

import { setup } from './harness.js'

// Regression: a restore visit waiting on popstate that gets interrupted by a
// new navigation must be torn down (cancelVisit), so its delayed popstate can't
// later fire stray adapter lifecycle calls for the abandoned visit.
describe('restore interrupted by a new visit', () => {
  let h
  const visitCalls = []

  beforeAll(async () => {
    h = await setup({ url: 'http://localhost:3000/navigation' })
    h.router.visit = (url, opts = {}) => visitCalls.push({ url: String(url), opts })
    // Restore would land via a *delayed* popstate; the interrupt happens first.
    globalThis.history.back = () => {
      globalThis.location = new URL('http://localhost:3000/')
      setTimeout(() => h.winEvents.dispatchEvent(new Event('popstate')), 30)
    }
    h.initHotwireNative({ debug: false })
    h.loadFixture('turbo.js')
    await h.tick()
  })

  it('does not emit the restore lifecycle after being cancelled', async () => {
    visitCalls.length = 0
    h.turboMessages.length = 0

    // The restore only waits on popstate when Inertia has pushed an entry to
    // step back onto; without one it requests the page straight away and there
    // is no pending visit to race with.
    globalThis.history.pushState({ page: {} }, '', '/pushed')

    // Start a restore (arms the popstate listener), then immediately start a new
    // advance visit — Navigator#stop() cancels the pending restore.
    window.Turbo.navigator.startVisit('http://localhost:3000/', 'restore-1', { action: 'restore' })
    window.Turbo.navigator.startVisit('http://localhost:3000/next', 'advance-1', { action: 'advance' })

    // Let the (now-detached) popstate fire and any rAF callbacks run.
    await h.tick(60)

    // The restore's request-lifecycle calls must not have fired.
    const names = h.turboMessages.map((m) => m.name)
    expect(names).not.toContain('visitRequestStarted')
    expect(names).not.toContain('visitRequestCompleted')

    // The interrupting advance visit is the only one that performed a request.
    expect(visitCalls.map((c) => c.url)).toEqual(['http://localhost:3000/next'])
  })
})
