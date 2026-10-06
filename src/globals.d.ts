// Hand-written ambient types for the native Hotwire Native protocol and the
// globals this package installs / reads. Authored by hand (no codegen) so the
// published source stays debuggable in the webview; verified by
// tests/types.test-d.ts.

/** A bridge message exchanged between the web page and the native app. */
export interface BridgeMessage {
  id: string
  component: string
  event: string
  data: Record<string, unknown>
}

/** How a proposed visit should be presented natively. */
export interface VisitProposalOptions {
  action: 'advance' | 'replace' | 'restore'
}

/**
 * The native adapter injected by Hotwire Native's `turbo.js`. Our driver calls
 * these to report an Inertia visit's progress; `visit` is the package's own
 * Visit instance and is opaque to callers.
 */
export interface TurboNativeAdapter {
  visitProposedToLocation(location: URL, options: VisitProposalOptions): void
  visitStarted(visit: unknown): void
  visitRequestStarted(visit: unknown): void
  visitRequestCompleted(visit: unknown): void
  visitRequestFailedWithStatusCode(visit: unknown, statusCode: number): void
  visitRequestFinished(visit: unknown): void
  visitRendered(visit: unknown): void
  visitCompleted(visit: unknown): void
  formSubmissionStarted(submission: { location: URL }): void
  formSubmissionFinished(submission: { location: URL }): void
  pageInvalidated(): void
}

/** The `window.Turbo` shim this package installs for `turbo.js` to drive. */
export interface TurboShim {
  /** @internal Marks the shim as ours so `initHotwireNative()` stays idempotent. */
  readonly __inertiaHotwireNative?: true
  session: unknown
  navigator: unknown
  registerAdapter(adapter: TurboNativeAdapter): void
  registerDriver(Driver: new (session: unknown) => unknown): void
}

/** The native bridge adapter (`window.nativeBridge`) that connects to the web bridge. */
export interface NativeBridgeAdapter {
  platform: string
  supportedComponents: string[]
  supportsComponent(component: string): boolean
  receive(message: BridgeMessage): void
}

/** Web side of the Hotwire Native bridge, exposed as `window.HotwireNative.web`. */
export interface WebBridge {
  start(): void
  setAdapter(adapter: NativeBridgeAdapter): void
  adapterDidUpdateSupportedComponents(): void
  supportsComponent(component: string): boolean
  send(message: {
    component: string
    event: string
    data?: Record<string, unknown>
    callback?: (message: BridgeMessage) => void
  }): string | null
  receive(message: BridgeMessage): void
  removeCallback(id: string | null): void
  removePendingMessagesFor(component: string): void
}

/** A WKWebView message handler (`window.webkit.messageHandlers.*`). */
export interface WebkitMessageHandler {
  postMessage(message: unknown): void
}

declare global {
  interface Window {
    /** Installed by `initHotwireNative()`; driven by Hotwire Native's `turbo.js`. */
    Turbo?: TurboShim
    /** Web bridge container. Feature-detect support via `web.supportsComponent`. */
    HotwireNative?: { web: WebBridge }
    /** Present inside WKWebView (iOS). Used to feature-detect the native shell. */
    webkit?: {
      messageHandlers?: {
        turbo?: WebkitMessageHandler
        bridge?: WebkitMessageHandler
        [name: string]: WebkitMessageHandler | undefined
      }
    }
  }
}
