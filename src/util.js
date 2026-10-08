// v4 UUID for restoration identifiers. Falls back to a manual generator on
// older webviews / non-secure contexts where crypto.randomUUID is unavailable.
export function uuid() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16)
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export function expandURL(locatable) {
  return new URL(locatable.toString(), document.baseURI)
}

// The web bridge core, or undefined during SSR (no window) and before it loads.
export function webBridge() {
  return typeof window === 'undefined' ? undefined : window.HotwireNative?.web
}
