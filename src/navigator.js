import { uuid, expandURL } from './util.js'
import { log } from './log.js'
import Visit from './visit.js'

// Minimal implementation of the Turbo.navigator API that turbo.js drives.
export default class Navigator {
  constructor(delegate) {
    this.delegate = delegate // Session
  }

  get location() {
    return new URL(this.delegate.locationOverride ?? window.location.href)
  }

  get adapter() {
    return this.delegate.adapter
  }

  get driver() {
    return this.delegate.driver
  }

  get view() {
    return this.delegate.view
  }

  get restorationIdentifier() {
    return this.driver?.restorationIdentifier || uuid()
  }

  startVisit(locatable, restorationIdentifier, options = {}) {
    log('native', 'startVisit', { location: String(locatable), restorationIdentifier, options })
    this.stop()
    this.currentVisit = new Visit(this.driver, expandURL(locatable), restorationIdentifier, options)
    this.currentVisit.start()
  }

  stop() {
    if (this.currentVisit) {
      this.currentVisit.cancel()
      delete this.currentVisit
    }
  }

  locationWithActionIsSamePage() {
    return false
  }
}
