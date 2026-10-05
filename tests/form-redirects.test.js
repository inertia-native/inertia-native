import { describe, it, expect, beforeAll } from 'vitest'

import { setup } from './harness.js'

// With proposeFormRedirects, a form that lands on another URL proposes it to
// native, as Turbo does with a form's redirect.
describe('form redirects', () => {
  let h

  beforeAll(async () => {
    h = await setup({ url: 'http://localhost:3000/posts/new' })
    h.router.visit = () => {}
    h.initHotwireNative({ debug: false, proposeFormRedirects: true })
    h.loadFixture('turbo.js')
    await h.tick()
  })

  // Inertia renders the result page (moving the URL) before `finish`.
  function submit({ landsOn, ...visitState }) {
    globalThis.location = new URL('http://localhost:3000/posts/new')
    h.turboMessages.length = 0
    const visit = { url: 'http://localhost:3000/posts', method: 'post' }
    h.dispatchInertia('start', { visit })
    globalThis.location = new URL(landsOn)
    h.dispatchInertia('finish', { visit: { ...visit, ...visitState } })
  }

  it('proposes the page a form landed on', () => {
    submit({ landsOn: 'http://localhost:3000/posts/1' })

    const names = h.turboMessages.map((m) => m.name)
    expect(names).not.toContain('visitProposalRefreshingPage')
    const proposed = h.turboMessages.find((m) => m.name === 'visitProposed')
    expect(proposed?.data?.location).toBe('http://localhost:3000/posts/1')
    expect(proposed?.data?.options?.action).toBe('advance')
    // The override is gone once the proposal is made.
    expect(window.Turbo.navigator.location.href).toBe('http://localhost:3000/posts/1')
  })

  // Validation errors redirect back to the form.
  it('stays put when the form lands on its own URL', () => {
    submit({ landsOn: 'http://localhost:3000/posts/new#errors' })

    expect(h.turboMessages.map((m) => m.name)).not.toContain('visitProposed')
  })

  it('stays put when the submission was cancelled', () => {
    submit({ landsOn: 'http://localhost:3000/posts/1', cancelled: true })

    expect(h.turboMessages.map((m) => m.name)).not.toContain('visitProposed')
  })
})

describe('form redirects (default)', () => {
  it('keeps the result in the web view', async () => {
    const h = await setup({ url: 'http://localhost:3000/posts/new' })
    h.router.visit = () => {}
    h.initHotwireNative({ debug: false })
    h.loadFixture('turbo.js')
    await h.tick()

    const visit = { url: 'http://localhost:3000/posts', method: 'post' }
    h.dispatchInertia('start', { visit })
    globalThis.location = new URL('http://localhost:3000/posts/1')
    h.dispatchInertia('finish', { visit })

    expect(h.turboMessages.map((m) => m.name)).not.toContain('visitProposed')
  })
})
