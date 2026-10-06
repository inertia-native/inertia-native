import Session from './session.js'
import Navigator from './navigator.js'
import InertiaDriver from './driver.js'
import { installBridge } from './bridge.js'
import { enableDebug, log } from './log.js'

// Installs the `window.Turbo` shim that Hotwire Native's injected turbo.js
// drives. Inert in a regular browser (nothing registers an adapter).
export function initInertiaNative({ debug = false, proposeFormRedirects = false } = {}) {
  if (debug) enableDebug()

  // Idempotent: a repeat call (HMR, double import, StrictMode) would register a
  // second driver and report every Inertia event to native twice.
  if (window.Turbo?.__inertiaNative) {
    log('native', 'initInertiaNative — already installed, skipping')
    return
  }

  log('native', 'initInertiaNative — installing window.Turbo shim')

  const session = new Session()

  window.Turbo = {
    __inertiaNative: true,
    session,
    navigator: new Navigator(session),

    registerAdapter(adapter) {
      session.registerAdapter(adapter)
    },

    registerDriver(Driver) {
      session.registerDriver(new Driver(session))
    },
  }

  session.registerDriver(new InertiaDriver(session, { proposeFormRedirects }))
  installBridge()

  // Cold boot: if turbo.js ran before this bundle, it's waiting on a turbo:load
  // event; dispatch one so it registers its adapter and reports pageLoaded.
  setTimeout(() => {
    log('native', 'dispatching turbo:load (cold boot)')
    document.dispatchEvent(new Event('turbo:load'))
  }, 0)
}
