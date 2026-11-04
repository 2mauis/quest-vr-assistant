/**
 * Hooks on `window.__display`. `adoptSession` is the native shell's entry point
 * (it pairs itself and injects the session token); `disconnectForTest` lets the
 * e2e suite simulate a network drop.
 */
export interface DisplayHooks {
  adoptSession(token: unknown): boolean;
  disconnectForTest(): void;
}

declare global {
  interface Window {
    __display?: DisplayHooks;
  }
}
