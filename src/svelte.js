import { onDestroy } from 'svelte'
import { readable } from 'svelte/store'

// Generic Svelte helper over the web bridge core (window.HotwireNative.web).
// `supported` is a readable store that flips when the native handshake
// completes after mount; `send` is a plain function.
export function useBridgeComponent(component) {
  const sentIds = []

  const supported = readable(
    !!window.HotwireNative?.web?.supportsComponent(component),
    (set) => {
      const check = () =>
        set(!!window.HotwireNative?.web?.supportsComponent(component))
      check()
      // Native support can arrive after mount (async handshake); the bridge
      // writes data-bridge-components on <html>, so observe it and re-check.
      const observer = new MutationObserver(check)
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-bridge-components'],
      })
      return () => observer.disconnect()
    }
  )

  // Bumped on native:restore (Android, back from a native screen); reference
  // it where `connect` is sent to send it again.
  const restored = readable(0, (set) => {
    let count = 0
    const onRestore = () => set(++count)
    document.addEventListener('native:restore', onRestore)
    return () => document.removeEventListener('native:restore', onRestore)
  })

  onDestroy(() => {
    const web = window.HotwireNative?.web
    sentIds.forEach((id) => web?.removeCallback(id))
    web?.removePendingMessagesFor(component)
  })

  function send(event, data = {}, callback) {
    const web = window.HotwireNative?.web
    if (!web) return null
    const id = web.send({
      component,
      event,
      data: { ...data, metadata: { url: window.location.href } },
      callback,
    })
    if (id) sentIds.push(id)
    return id
  }

  return { supported, send, restored }
}
