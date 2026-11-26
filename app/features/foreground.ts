import { AppState } from 'react-native'

// Android 16 blocks network access for apps in the background. A full-screen wallet
// (Phantom, Solflare) puts Mobiloot in the background while it signs, so a request
// sent the moment the wallet returns can fail before Mobiloot is on screen again.
// The Seeker's own wallet is a bottom sheet and never triggers this.

/** Resolves once the app is in the foreground, or after `timeoutMs` regardless. */
export function whenForeground(timeoutMs = 10_000): Promise<void> {
  if (AppState.currentState === 'active') return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      sub.remove()
      resolve()
    }
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') done()
    })
    const timer = setTimeout(done, timeoutMs)
  })
}

/**
 * Runs a network call, and if it fails, waits for the foreground and tries again.
 * Only for calls that are safe to repeat.
 */
export async function withForegroundRetry<T>(call: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    await whenForeground()
    try {
      return await call()
    } catch (e) {
      if (i >= attempts) throw e
      await new Promise((r) => setTimeout(r, 400 * i))
    }
  }
}
