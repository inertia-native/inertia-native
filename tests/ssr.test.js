import { describe, expect, it } from 'vitest'
import { initInertiaNative } from '../src/index.js'

describe('SSR', () => {
  it('is a no-op without window', () => {
    expect(typeof window).toBe('undefined')
    expect(() => initInertiaNative({ debug: true })).not.toThrow()
  })
})
