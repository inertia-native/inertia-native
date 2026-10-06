import { describe, it, expect, beforeAll } from 'vitest'

import { setup } from './harness.js'

// Form (non-GET) submissions stay in the web view — no native visit is
// proposed — and report formSubmissionStarted/Finished to native.
describe('forms', () => {
  let h
  const visitCalls = []

  beforeAll(async () => {
    h = await setup()
    h.router.visit = (url, opts = {}) => visitCalls.push({ url: String(url), opts })
    h.initHotwireNative({ debug: false })
    h.loadFixture('turbo.js')
    await h.tick()
  })

  it('passes a POST through without proposing a native visit', async () => {
    h.turboMessages.length = 0
    const before = h.dispatchInertia(
      'before',
      { visit: { url: 'http://localhost:3000/resources', method: 'post' } },
      { cancelable: true }
    )
    h.dispatchInertia('start', { visit: { url: 'http://localhost:3000/resources', method: 'post' } })
    h.dispatchInertia('finish', { visit: { url: 'http://localhost:3000/resources', method: 'post' } })
    await h.tick()

    const names = h.turboMessages.map((m) => m.name)
    expect(before.defaultPrevented).toBe(false)
    expect(names).toContain('formSubmissionStarted')
    expect(names).toContain('formSubmissionFinished')
    expect(names).not.toContain('visitProposed')
    expect(names).not.toContain('visitRequestStarted')
  })

  it('still drives the lifecycle for a GET visit (regression)', async () => {
    h.turboMessages.length = 0
    window.Turbo.navigator.startVisit('http://localhost:3000/navigation', null, { action: 'advance' })
    await h.tick()
    const callbacks = visitCalls.at(-1).opts
    callbacks.onStart()
    callbacks.onSuccess()
    callbacks.onFinish()
    await h.tick(20)

    const names = h.turboMessages.map((m) => m.name)
    expect(names).toContain('visitRequestStarted')
    expect(names).toContain('visitRequestCompleted')
    expect(names).toContain('visitRequestFinished')
    expect(names).not.toContain('formSubmissionStarted')
  })
})
