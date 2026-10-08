import { describe, expect, it, vi } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { get } from 'svelte/store'

// Svelte runs onDestroy during SSR; capture it as svelte.test.js does.
const destroyers = []
vi.mock('svelte', () => ({ onDestroy: (fn) => destroyers.push(fn) }))

import { initInertiaNative } from '../src/index.js'
import { useBridgeComponent as useVueBridgeComponent } from '../src/vue.js'
import { useBridgeComponent as useSvelteBridgeComponent } from '../src/svelte.js'

describe('SSR', () => {
  it('runs without window', () => {
    expect(typeof window).toBe('undefined')
  })

  it('initInertiaNative is a no-op', () => {
    expect(() => initInertiaNative({ debug: true })).not.toThrow()
  })

  it('vue useBridgeComponent renders unsupported', async () => {
    let api
    const app = createSSRApp({
      setup() {
        api = useVueBridgeComponent('menu')
        return () => h('div')
      },
    })
    await expect(renderToString(app)).resolves.toBe('<div></div>')
    expect(api.supported.value).toBe(false)
    expect(api.send('connect')).toBe(null)
  })

  it('svelte useBridgeComponent renders unsupported', () => {
    destroyers.length = 0
    const { supported, restored, send } = useSvelteBridgeComponent('menu')
    expect(get(supported)).toBe(false)
    expect(get(restored)).toBe(0)
    expect(send('connect')).toBe(null)
    expect(() => destroyers.forEach((fn) => fn())).not.toThrow()
  })
})
