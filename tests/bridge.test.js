import { describe, it, expect, beforeAll } from 'vitest'

import { setup } from './harness.js'

// B1: the web bridge installs window.HotwireNative.web, the native bridge.js
// connects on web-bridge:ready, registers supported components, and messages
// round-trip with callbacks.
describe('bridge handshake', () => {
  let h
  let web

  beforeAll(async () => {
    h = await setup()
    // Native injects bridge.js first (installs window.nativeBridge, listens for
    // web-bridge:ready), then our bundle installs the web side.
    h.loadFixture('bridge.js')
    h.initInertiaNative({ debug: false })
    web = window.HotwireNative.web
    // Native registers the components it supports.
    globalThis.nativeBridge.register(['form', 'menu', 'overflow-menu'])
    await h.tick()
  })

  it('connects and reflects the supported components', () => {
    expect(web).toBeTruthy()
    expect(document.documentElement.dataset.bridgePlatform).toBe('ios')
    expect(document.documentElement.dataset.bridgeComponents).toBe('form menu overflow-menu')
    expect(web.supportsComponent('form')).toBe(true)
    expect(web.supportsComponent('nope')).toBe(false)
  })

  it('sends to native and runs the reply callback', () => {
    let reply = null
    const id = web.send({
      component: 'form',
      event: 'connect',
      data: { submitTitle: 'Submit' },
      callback: (m) => {
        reply = m
      },
    })
    const sent = h.bridgeMessages.find((m) => m?.id === id)
    expect(sent?.component).toBe('form')
    expect(sent?.event).toBe('connect')

    globalThis.nativeBridge.replyWith({ id, component: 'form', event: 'connect', data: { ok: true } })
    expect(reply?.data?.ok).toBe(true)
  })
})
