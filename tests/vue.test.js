// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createApp, h } from 'vue'

import { useBridgeComponent } from '../src/vue.js'
import { resetBridge, connect, register, tick } from './bridge-dom.js'

// Mounts a real Vue app whose setup() runs the composable, so onMounted /
// onUnmounted fire against jsdom. Returns the composable result plus unmount.
function mount(component) {
  let api
  const app = createApp({
    setup() {
      api = useBridgeComponent(component)
      return () => h('div')
    },
  })
  const container = document.createElement('div')
  app.mount(container)
  return { api, unmount: () => app.unmount() }
}

describe('vue useBridgeComponent', () => {
  beforeEach(() => resetBridge())
  afterEach(() => resetBridge())

  it('reflects initial support at setup time', () => {
    connect(['menu'])
    const { api, unmount } = mount('menu')
    expect(api.supported.value).toBe(true)
    unmount()
  })

  it('flips supported when native support arrives after mount', async () => {
    const { web, adapter } = connect([])
    const { api, unmount } = mount('menu')
    expect(api.supported.value).toBe(false)

    register(web, adapter, ['menu'])
    await tick()
    expect(api.supported.value).toBe(true)
    unmount()
  })

  it('sends to native and runs the reply callback', () => {
    const { web, adapter } = connect(['menu'])
    const { api, unmount } = mount('menu')

    let reply = null
    const id = api.send('connect', { title: 'x' }, (m) => {
      reply = m
    })
    expect(typeof id).toBe('string')
    expect(adapter.received.at(-1)).toMatchObject({ component: 'menu', event: 'connect' })
    // The wrapper injects the current url as metadata.
    expect(adapter.received.at(-1).data.metadata.url).toBe(window.location.href)

    web.receive({ id, component: 'menu', event: 'connect', data: { ok: true } })
    expect(reply?.data?.ok).toBe(true)
    unmount()
  })

  it('returns null when the component is unsupported', () => {
    connect(['form'])
    const { api, unmount } = mount('menu')
    expect(api.send('connect')).toBeNull()
    unmount()
  })

  it('drops pending callbacks after unmount', () => {
    const { web } = connect(['menu'])
    const { api, unmount } = mount('menu')

    let called = false
    const id = api.send('connect', {}, () => {
      called = true
    })
    unmount()

    // A late native reply must not fire the cleaned-up callback.
    web.receive({ id, component: 'menu', event: 'connect', data: {} })
    expect(called).toBe(false)
  })

  it('bumps restored on native:restore until unmount', () => {
    connect(['button'])
    const { api, unmount } = mount('button')
    expect(api.restored.value).toBe(0)

    document.dispatchEvent(new Event('native:restore'))
    expect(api.restored.value).toBe(1)

    unmount()
    document.dispatchEvent(new Event('native:restore'))
    expect(api.restored.value).toBe(1)
  })

  it('stops observing support changes after unmount', async () => {
    const { web, adapter } = connect([]) // menu not supported yet
    const { api, unmount } = mount('menu')
    expect(api.supported.value).toBe(false)
    unmount()

    // Support arrives after unmount; the disconnected observer must not touch it.
    register(web, adapter, ['menu'])
    await tick()
    expect(api.supported.value).toBe(false)
  })
})
