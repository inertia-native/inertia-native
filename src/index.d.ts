// Public types for the framework-agnostic core entry (`inertia-native`).
// Importing from here also activates the global augmentation in globals.d.ts
// (so `window.Turbo`, `window.HotwireNative`, `window.webkit` are typed).
import type { BridgeMessage } from './globals.js'

export interface InitInertiaNativeOptions {
  /**
   * Log the web↔native message flow to the webview console (attach Safari Web
   * Inspector to see it). Off by default.
   */
  debug?: boolean
  /**
   * After a form submission lands on another URL, propose that URL to native,
   * as Turbo does with a form's redirect. Native's path configuration then
   * decides, e.g. dismissing a modal to show the result. Off by default: the
   * result stays in the web view the form was in.
   */
  proposeFormRedirects?: boolean
}

/**
 * Install the `window.Turbo` shim that Hotwire Native's injected `turbo.js`
 * drives. Call once, before `createInertiaApp`. In a regular browser it stays
 * inert and Inertia navigates as usual.
 */
export function initInertiaNative(options?: InitInertiaNativeOptions): void

export type { BridgeMessage }
