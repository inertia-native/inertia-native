import PageView from './page-view.js'
import { log } from './log.js'

// How turbo.js tells native a cold boot's page is on screen (iOS: pageLoaded;
// Android: visitRenderedForColdBoot, called back by native). Native titles the
// screen with document.title at that point.
const COLD_BOOT_REPORTS = ['pageLoaded', 'visitRenderedForColdBoot']

// Glue between turbo.js (the native adapter) and the Inertia driver.
export default class Session {
  view = new PageView(this, document.documentElement)
  // Set only while proposing a visit away from a page Inertia already left.
  locationOverride = null

  registerAdapter(adapter) {
    log('native', 'adapter registered (turbo.js connected)')
    this.adapter = adapter
    this.#holdColdBootReports(adapter)
  }

  // turbo.js connects as soon as this bundle has run, before Inertia renders
  // the first page and its <Head> title. Hold the reports until it has.
  #holdColdBootReports(adapter) {
    for (const name of COLD_BOOT_REPORTS) {
      const report = adapter[name]
      if (typeof report !== 'function') continue
      adapter[name] = (...args) => {
        this.driver.firstPageRendered.then(() => report.apply(adapter, args))
      }
    }
  }

  registerDriver(driver) {
    this.driver = driver
    driver.start()
  }

  visitProposedToLocation(location, options) {
    log('inertia', 'visitProposedToLocation', { location: location.toString(), options })
    this.adapter?.visitProposedToLocation(location, options)
  }

  // turbo.js treats a proposal for Turbo.navigator.location as a refresh. A
  // form's redirect is already rendered when we propose it, so report the
  // form's page as current for the call, as Turbo would.
  proposeVisitFrom(fromLocation, location, options) {
    this.locationOverride = fromLocation
    try {
      this.visitProposedToLocation(location, options)
    } finally {
      this.locationOverride = null
    }
  }

  clearCache() {}
}
