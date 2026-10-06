// Public types for the React entry (`inertia-native/react`).
import type { BridgeMessage } from './globals.js'

export type { BridgeMessage }

export interface BridgeComponent {
  /** Whether the connected native app supports this bridge component. */
  supported: boolean
  /**
   * Send a message to native. Returns the message id (for callback cleanup),
   * or `null` if it was queued or the component is unsupported.
   */
  send(
    event: string,
    data?: Record<string, unknown>,
    callback?: (message: BridgeMessage) => void,
  ): string | null
  /**
   * Bumped each time the web view returns from a native screen
   * (`native:restore`). Put it in the deps of the effect that sends `connect`
   * so native redraws the component.
   */
  restored: number
}

/**
 * Generic React wrapper over the web bridge core (`window.HotwireNative.web`).
 * Re-checks support when the native handshake completes after mount.
 */
export function useBridgeComponent(component: string): BridgeComponent
