import { installBridge } from '../src/bridge.js'

// Wires the real web bridge (window.HotwireNative.web) to a fake native adapter,
// for exercising the framework wrappers under jsdom (real MutationObserver +
// real <html> dataset). Call resetBridge() before each test.
export function resetBridge() {
  delete window.HotwireNative
  document.documentElement.removeAttribute('data-bridge-components')
  document.documentElement.removeAttribute('data-bridge-platform')
}

// A minimal stand-in for Hotwire Native's injected bridge adapter.
export function fakeAdapter(components = []) {
  return {
    platform: 'ios',
    supportedComponents: components,
    received: [],
    supportsComponent(component) {
      return this.supportedComponents.includes(component)
    },
    receive(message) {
      this.received.push(message)
    },
  }
}

// Installs the web bridge and connects the adapter (writes data-bridge-* onto
// <html>, mirroring the real handshake).
export function connect(components = []) {
  const web = installBridge()
  const adapter = fakeAdapter(components)
  web.setAdapter(adapter)
  return { web, adapter }
}

// Simulates native registering more components after connect: rewrites the
// dataset attribute the wrappers observe.
export function register(web, adapter, components) {
  adapter.supportedComponents = adapter.supportedComponents.concat(components)
  web.adapterDidUpdateSupportedComponents()
}

export const tick = () => new Promise((r) => setTimeout(r, 0))
