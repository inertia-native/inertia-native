import * as inertia from '@inertiajs/core'
import { log } from './log.js'

const { router } = inertia

// No popstate within this window after history.back() means there's no cached
// entry to restore (cold boot onto this screen) → fall back to a fresh request.
const RESTORE_POPSTATE_TIMEOUT_MS = 250

// Visits that update the current page rather than open a new one: partial
// reloads, polls, deferred props, filters. Native would run them as a full
// visit and drop these options.
function staysOnPage(visit) {
  return (
    visit.async ||
    visit.preserveState === true ||
    visit.preserveUrl ||
    visit.only?.length > 0 ||
    visit.except?.length > 0 ||
    visit.reset?.length > 0 ||
    withoutHash(new URL(visit.url, window.location.href)) === withoutHash(window.location)
  )
}

function withoutHash(url) {
  return url.href.split('#')[0]
}

export default class InertiaDriver {
  #activeVisit = null
  #cancelToken = null
  #restoreCleanup = null
  // Inertia writes the first page with replaceState, so 0 means the entry
  // behind us is not one of ours.
  #pushedEntries = 0
  #historyTracked = false
  // Targets of location visits (409 + X-Inertia-Location) taken from Inertia,
  // keyed by the response's headers object.
  #locations = new WeakMap()

  constructor(session) {
    this.session = session
  }

  get adapter() {
    return this.session.adapter
  }

  get restorationIdentifier() {
    return undefined
  }

  start() {
    log('inertia', 'driver started')
    this.#trackHistoryDepth()
    this.#interceptLocationVisits()
    this.#setupInertiaListeners()
  }

  // Inertia follows a location visit with window.location, out of native's
  // sight and before any event fires. Stripping the header turns it into an
  // httpException, which the listener below hands to native instead.
  // `http` exists from @inertiajs/core 3; on v2 Inertia still navigates itself.
  #interceptLocationVisits() {
    inertia.http?.onError((error) => {
      const response = error.response
      const location = response?.headers?.['x-inertia-location']
      if (!this.adapter || response.status !== 409 || !location) return

      delete response.headers['x-inertia-location']
      this.#locations.set(response.headers, new URL(location, window.location.href))
    })
  }

  #handOffLocation(location) {
    const visit = this.#activeVisit

    if (visit) {
      if (location.origin !== window.location.origin) {
        // As turbo.js reports a cross-origin redirect: native refetches the
        // visit, follows the redirect, pops this screen and routes the target.
        log('inertia', 'location visit (cross-origin) → visitRequestFailedWithStatusCode(0)', { location: location.href })
        this.adapter?.visitRequestFailedWithStatusCode(visit, 0)
      } else {
        // A cold reload of the visit gets the server's plain redirect, or the
        // new asset version.
        log('inertia', 'location visit → pageInvalidated', { location: location.href })
        this.adapter?.pageInvalidated()
      }
      return
    }

    if (withoutHash(location) === withoutHash(window.location)) {
      log('inertia', 'location visit (same page) → pageInvalidated', { location: location.href })
      this.adapter?.pageInvalidated()
    } else {
      log('inertia', 'location visit → visitProposed', { location: location.href })
      this.session.visitProposedToLocation(location, { action: 'advance' })
    }
  }

  // Counts history writes rather than the visits we see, so navigations that
  // bypass the driver still land in the count.
  #trackHistoryDepth() {
    if (this.#historyTracked) return
    this.#historyTracked = true

    const pushState = window.history.pushState.bind(window.history)
    window.history.pushState = (...args) => {
      const result = pushState(...args)
      this.#pushedEntries += 1
      return result
    }
  }

  visitStarted(_visit) {}

  issueRequest(visit) {
    log('inertia', 'issueRequest', { id: visit.identifier, url: visit.location.href, action: visit.action })
    this.#activeVisit = visit

    if (visit.action === 'restore') {
      this.#restoreFromHistory(visit)
      return
    }

    // setTimeout(0) moves router.visit() out of the synchronous native callback
    // chain. Called inline, Inertia's async continuation after `before` never
    // runs in WKWebView's context.
    setTimeout(() => {
      router.visit(visit.location.href, {
        replace: visit.action === 'replace',
        onCancelToken: (token) => {
          this.#cancelToken = token
        },
      })
    }, 0)
  }

  // Inertia's popstate handler swaps the cached page quietly (no
  // start/success/finish events), so we drive the native visit lifecycle here.
  #restoreFromHistory(visit) {
    let settled = false

    const cleanup = () => {
      settled = true
      clearTimeout(fallback)
      window.removeEventListener('popstate', onPopstate)
      if (this.#restoreCleanup === cleanup) this.#restoreCleanup = null
    }
    this.#restoreCleanup = cleanup

    const freshRequest = (reason) => {
      cleanup()
      log('inertia', reason, { url: visit.location.href })
      router.visit(visit.location.href, {
        replace: true,
        onCancelToken: (token) => {
          this.#cancelToken = token
        },
      })
    }

    const onPopstate = () => {
      if (settled) return

      // Backstop for a #pushedEntries overcount: popstate fires wherever we
      // land, including on a non-Inertia entry where nothing was restored.
      //
      // This only sees the real landing spot because Inertia's own popstate
      // handler, registered first, defers its URL repair to a microtask. Make
      // that repair synchronous and both conditions stop firing.
      if (!window.history.state?.page || window.location.href !== visit.location.href) {
        this.#pushedEntries = 0
        freshRequest('restore: landed off-target → fresh request')
        return
      }

      cleanup()
      this.#pushedEntries = Math.max(0, this.#pushedEntries - 1)

      log('inertia', 'restore from history cache (no request)', { url: window.location.href })
      const adapter = this.adapter
      adapter?.visitRequestStarted(visit)
      adapter?.visitRequestCompleted(visit)
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          adapter?.visitRendered(visit)
          adapter?.visitCompleted(visit)
          adapter?.visitRequestFinished(visit)
          this.#activeVisit = null
        })
      )
    }

    const fallback = setTimeout(() => {
      if (settled) return
      freshRequest('restore: no cached entry → fresh request')
    }, RESTORE_POPSTATE_TIMEOUT_MS)

    // Stepping back off our own entries leaves the document, and the web view
    // paints Hotwire's bootstrap page before anything above can react. The
    // handlers can only recover from that blank, not prevent it.
    if (this.#pushedEntries === 0) {
      freshRequest('restore: at the first entry → fresh request')
      return
    }

    window.addEventListener('popstate', onPopstate)
    setTimeout(() => window.history.back(), 0)
  }

  changeHistory(_visit) {}
  loadCachedSnapshot(_visit) {}
  loadResponse(_visit) {}

  cancelVisit(_visit) {
    // A restore may still be waiting on popstate/fallback; tear it down so its
    // callbacks don't later fire for this abandoned visit.
    this.#restoreCleanup?.()

    // No router.cancel() in @inertiajs/core — cancel via the per-visit token.
    if (this.#activeVisit) {
      log('inertia', 'cancelVisit (in-flight)')
      try {
        this.#cancelToken?.cancel?.()
      } catch {
        // already settled
      }
    }
    this.#cancelToken = null
    this.#activeVisit = null
  }

  hasCachedSnapshot(_visit) {
    return false
  }

  isPageRefresh(visit) {
    return visit.location.href === window.location.href
  }

  #setupInertiaListeners() {
    router.on('before', (event) => {
      const { visit } = event.detail

      if (this.#activeVisit) {
        log('inertia', 'before (native-initiated, passthrough)', { url: visit.url })
        return
      }

      if (!this.adapter) return

      // turbo.js disables prefetching too: the next screen may load in another
      // web view, and proposing a prefetch would open it without a tap.
      if (visit.prefetch) {
        log('inertia', 'before (prefetch, cancelled)', { url: visit.url })
        event.preventDefault()
        return
      }

      // Form submissions stay in the webview; native is notified via
      // formSubmission{Started,Finished} in the start/finish handlers.
      if (visit.method !== 'get') {
        log('inertia', 'before (form submission, passthrough)', { url: visit.url, method: visit.method })
        return
      }

      if (staysOnPage(visit)) {
        log('inertia', 'before (same-page visit, passthrough)', { url: visit.url })
        return
      }

      log('inertia', 'before → visitProposed', { url: visit.url, replace: visit.replace })
      event.preventDefault()
      this.session.visitProposedToLocation(new URL(visit.url, window.location.href), {
        action: visit.replace ? 'replace' : 'advance',
      })
    })

    router.on('start', (event) => {
      const { visit } = event.detail
      if (visit.method !== 'get') {
        log('inertia', 'form start → formSubmissionStarted', { url: visit.url })
        this.adapter?.formSubmissionStarted({ location: new URL(visit.url, window.location.href) })
        return
      }
      if (!this.#activeVisit) return
      log('inertia', 'start → visitRequestStarted', { id: this.#activeVisit.identifier })
      this.adapter?.visitRequestStarted(this.#activeVisit)
    })

    router.on('success', () => {
      if (!this.#activeVisit) return
      const visit = this.#activeVisit
      log('inertia', 'success → visitRequestCompleted', { id: visit.identifier })
      this.adapter?.visitRequestCompleted(visit)
      // Double rAF: report rendered/completed only after the new page paints.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          log('native', 'visitRendered + visitCompleted', { id: visit.identifier })
          this.adapter?.visitRendered(visit)
          this.adapter?.visitCompleted(visit)
        })
      )
    })

    // v3.4 renamed `invalid` → `httpException`; listen for both to support the
    // whole >=2.0 peer range. A given core version fires only one name.
    const onHttpException = (event) => {
      const response = event.detail.response
      const location = response?.headers && this.#locations.get(response.headers)
      if (location) {
        event.preventDefault()
        this.#handOffLocation(location)
        return
      }

      if (!this.#activeVisit) return
      const status = response?.status ?? 0
      event.preventDefault()

      // A successful non-Inertia response is a page this bundle can't render
      // (e.g. a classic Turbo page). Have native reload the web view, as
      // turbo.js does when tracked assets change.
      if (status >= 200 && status < 300 && !response?.headers?.['x-inertia']) {
        log('inertia', 'non-Inertia response → pageInvalidated', { status })
        this.adapter?.pageInvalidated()
        return
      }

      log('inertia', 'httpException → visitRequestFailedWithStatusCode', { status })
      this.adapter?.visitRequestFailedWithStatusCode(this.#activeVisit, status)
    }
    router.on('httpException', onHttpException)
    router.on('invalid', onHttpException)

    // v3.4 renamed `exception` → `networkError`; status 0 routes it as a
    // non-HTTP failure.
    const onNetworkError = () => {
      if (!this.#activeVisit) return
      log('inertia', 'networkError → visitRequestFailedWithStatusCode(0)')
      this.adapter?.visitRequestFailedWithStatusCode(this.#activeVisit, 0)
    }
    router.on('networkError', onNetworkError)
    router.on('exception', onNetworkError)

    router.on('finish', (event) => {
      const { visit } = event.detail
      if (visit.method !== 'get') {
        log('inertia', 'form finish → formSubmissionFinished', { url: visit.url })
        this.adapter?.formSubmissionFinished({ location: new URL(visit.url, window.location.href) })
        return
      }
      if (!this.#activeVisit) return
      log('inertia', 'finish → visitRequestFinished', { id: this.#activeVisit.identifier })
      this.adapter?.visitRequestFinished(this.#activeVisit)
      this.#activeVisit = null
    })
  }
}
