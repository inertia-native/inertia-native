import { describe, it, expect, afterEach, vi } from 'vitest'
import { JSDOM } from 'jsdom'

import { setup } from './harness.js'

const INERTIA_PAGE = '<script data-page="app" type="application/json">{"component":"modals/new"}</script><div id="app"></div>'

// Native titles a cold-booted screen with document.title once turbo.js reports
// the page as rendered. turbo.js connects as soon as the bundle has run, but an
// Inertia page sets its <Head> title only after it renders, so the report has
// to wait for the first page.
describe('cold boot title', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  // The document as served: the layout's <title> and the given body.
  async function coldBoot(body = INERTIA_PAGE) {
    const h = await setup()
    const served = new JSDOM(`<body>${body}</body>`).window.document
    document.title = 'Layout'
    document.querySelector = (selector) => served.querySelector(selector)
    return h
  }

  // document.title each time iOS turbo.js tells native the page is loaded.
  function iosReports() {
    const titles = []
    const handler = window.webkit.messageHandlers.turbo
    const post = handler.postMessage
    handler.postMessage = (message) => {
      if (message.name === 'pageLoaded') titles.push(document.title)
      post(message)
    }
    return titles
  }

  // Inertia renders the first page; <Head> writes its title a moment later.
  async function renderFirstPage(h) {
    h.dispatchInertia('navigate', { page: { component: 'modals/new' } })
    setTimeout(() => {
      document.title = 'Modal Navigation'
    }, 1)
    await h.tick(40)
  }

  it('iOS: posts pageLoaded only after the first page, with its title', async () => {
    const h = await coldBoot()
    const titles = iosReports()

    h.initInertiaNative({ debug: false })
    h.loadFixture('turbo.js')
    await h.tick(40)
    expect(titles).toEqual([])

    await renderFirstPage(h)
    expect(titles).toEqual(['Modal Navigation'])
  })

  // Frames run only when the test paints one.
  function manualFrames(h) {
    let queued = []
    window.requestAnimationFrame = (callback) => queued.push(callback)
    return async () => {
      const callbacks = queued
      queued = []
      callbacks.forEach((callback) => callback())
      await h.tick(1)
    }
  }

  it('iOS: waits out <Head> titles that land after two frames', async () => {
    const h = await coldBoot()
    const titles = iosReports()
    const paint = manualFrames(h)

    h.initInertiaNative({ debug: false })
    h.loadFixture('turbo.js')
    h.dispatchInertia('navigate', { page: { component: 'modals/new' } })
    await h.tick(1)
    await paint()
    await paint()
    document.title = 'Modal Navigation'
    await paint()
    await paint()

    expect(titles).toEqual(['Modal Navigation'])
  })

  it('reports in a hidden web view, which never paints', async () => {
    const h = await coldBoot()
    const titles = iosReports()
    manualFrames(h)
    document.hidden = true

    h.initInertiaNative({ debug: false })
    h.loadFixture('turbo.js')
    h.dispatchInertia('navigate', { page: { component: 'modals/new' } })
    await h.tick(1)

    expect(titles).toHaveLength(1)
  })

  it('Android: holds visitRenderedForColdBoot until the first page', async () => {
    const h = await coldBoot()
    const reported = []
    const adapter = { visitRenderedForColdBoot: (id) => reported.push(id) }

    h.initInertiaNative({ debug: false })
    window.Turbo.registerAdapter(adapter)
    // Native answers turboIsReady by asking for the cold boot's render report.
    adapter.visitRenderedForColdBoot('cold-boot')
    await h.tick(40)
    expect(reported).toEqual([])

    await renderFirstPage(h)
    expect(reported).toEqual(['cold-boot'])
  })

  it('reports right away on a page without Inertia', async () => {
    const h = await coldBoot('')
    const titles = iosReports()

    h.initInertiaNative({ debug: false })
    h.loadFixture('turbo.js')
    await h.tick(40)
    expect(titles).toEqual(['Layout'])
  })

  // turbo.js injected before the bundle runs waits for turbo:load, which
  // initInertiaNative dispatches.
  it('waits for the first page when turbo.js connects before initInertiaNative', async () => {
    const h = await coldBoot()
    const titles = iosReports()

    h.loadFixture('turbo.js')
    h.initInertiaNative({ debug: false })
    await h.tick(40)
    expect(window.Turbo.session.adapter).toBeTruthy()
    expect(titles).toEqual([])

    await renderFirstPage(h)
    expect(titles).toEqual(['Modal Navigation'])
  })

  it('reports after 4 seconds when the first page never renders', async () => {
    const h = await coldBoot()
    const titles = iosReports()
    vi.useFakeTimers()

    h.initInertiaNative({ debug: false })
    h.loadFixture('turbo.js')
    await vi.advanceTimersByTimeAsync(3900)
    expect(titles).toEqual([])

    await vi.advanceTimersByTimeAsync(200)
    expect(titles).toEqual(['Layout'])
  })
})
