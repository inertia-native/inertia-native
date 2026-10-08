import { onMounted, onUnmounted, ref } from 'vue'
import { webBridge } from './util.js'

// Generic Vue composable over the web bridge core (window.HotwireNative.web).
// `supported` is a Ref that flips when the native handshake completes after
// mount; `send` is stable.
export function useBridgeComponent(component) {
  const supported = ref(!!webBridge()?.supportsComponent(component))
  // Bumped on native:restore (Android, back from a native screen); watch it to
  // send `connect` again.
  const restored = ref(0)
  const onRestore = () => {
    restored.value += 1
  }
  const sentIds = []
  let observer = null

  const check = () => {
    supported.value = !!webBridge()?.supportsComponent(component)
  }

  onMounted(() => {
    check()
    // Native support can arrive after mount (async handshake); the bridge writes
    // data-bridge-components on <html>, so observe it and re-check.
    observer = new MutationObserver(check)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-bridge-components'],
    })
    document.addEventListener('native:restore', onRestore)
  })

  onUnmounted(() => {
    observer?.disconnect()
    document.removeEventListener('native:restore', onRestore)
    const web = webBridge()
    sentIds.forEach((id) => web?.removeCallback(id))
    web?.removePendingMessagesFor(component)
  })

  function send(event, data = {}, callback) {
    const web = webBridge()
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
