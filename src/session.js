import PageView from './page-view.js'
import { log } from './log.js'

// Glue between turbo.js (the native adapter) and the Inertia driver.
export default class Session {
  view = new PageView(this, document.documentElement)
  // Set only while proposing a visit away from a page Inertia already left.
  locationOverride = null

  registerAdapter(adapter) {
    log('native', 'adapter registered (turbo.js connected)')
    this.adapter = adapter
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
