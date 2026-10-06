// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// The helper calls onDestroy() during "component init". There's no Svelte
// compiler in this test setup, so capture the cleanup callback instead of
// mounting a component. `svelte/store` (readable) is left real.
const destroyers = []
vi.mock('svelte', () => ({
  onDestroy: (fn) => destroyers.push(fn),
}))

import { get } from 'svelte/store'
import { useBridgeComponent } from '../src/svelte.js'
import { resetBridge, connect, register, tick } from './bridge-dom.js'

// Subscribe so the readable store's start fn runs (attaching the observer);
// returns the latest value and an unsubscribe.
function live(store) {
  let value
  const unsubscribe = store.subscribe((v) => {
    value = v
  })
  return { get: () => value, unsubscribe }
}

describe('svelte useBridgeComponent', () => {
  beforeEach(() => {
    destroyers.length = 0
    resetBridge()
  })
  afterEach(() => resetBridge())

  it('reflects initial support (before any subscriber)', () => {
    connect(['menu'])
    const { supported } = useBridgeComponent('menu')
    expect(get(supported)).toBe(true)
  })

  it('flips supported when native support arrives after subscribe', async () => {
    const { web, adapter } = connect([])
    const { supported } = useBridgeComponent('menu')
    const sub = live(supported)
    expect(sub.get()).toBe(false)

    register(web, adapter, ['menu'])
    await tick()
    expect(sub.get()).toBe(true)
    sub.unsubscribe()
  })

  it('sends to native and runs the reply callback', () => {
    const { web, adapter } = connect(['menu'])
    const { send } = useBridgeComponent('menu')

    let reply = null
    const id = send('connect', { title: 'x' }, (m) => {
      reply = m
    })
    expect(typeof id).toBe('string')
    expect(adapter.received.at(-1)).toMatchObject({ component: 'menu', event: 'connect' })
    expect(adapter.received.at(-1).data.metadata.url).toBe(window.location.href)

    web.receive({ id, component: 'menu', event: 'connect', data: { ok: true } })
    expect(reply?.data?.ok).toBe(true)
  })

  it('returns null when the component is unsupported', () => {
    connect(['form'])
    const { send } = useBridgeComponent('menu')
    expect(send('connect')).toBeNull()
  })

  it('drops pending callbacks on destroy', () => {
    const { web } = connect(['menu'])
    const { send } = useBridgeComponent('menu')

    let called = false
    const id = send('connect', {}, () => {
      called = true
    })
    // Simulate the component being destroyed.
    destroyers.forEach((fn) => fn())

    web.receive({ id, component: 'menu', event: 'connect', data: {} })
    expect(called).toBe(false)
  })

  it('bumps restored on native:restore while subscribed', () => {
    connect(['button'])
    const { restored } = useBridgeComponent('button')
    const sub = live(restored)
    expect(sub.get()).toBe(0)

    document.dispatchEvent(new Event('native:restore'))
    expect(sub.get()).toBe(1)

    sub.unsubscribe()
    document.dispatchEvent(new Event('native:restore'))
    expect(sub.get()).toBe(1)
  })

  it('stops observing support changes after the last unsubscribe', async () => {
    const { web, adapter } = connect([])
    const { supported } = useBridgeComponent('menu')
    const sub = live(supported)
    expect(sub.get()).toBe(false)
    sub.unsubscribe() // readable stop fn disconnects the observer

    register(web, adapter, ['menu'])
    await tick()
    // A fresh read still reflects reality, but the earlier subscriber's observer
    // is gone — re-subscribing recomputes from scratch.
    expect(sub.get()).toBe(false)
    expect(get(supported)).toBe(true)
  })
})
