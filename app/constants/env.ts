// Build-time settings. EXPO_PUBLIC_* values are inlined into the bundle.
// For local development against localnet on a USB/emulator device:
//   adb reverse tcp:8787 tcp:8787 && adb reverse tcp:8899 tcp:8899
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8787'

export const APP_IDENTITY = {
  name: 'Mobiloot',
  uri: 'https://mobiloot.com',
  icon: 'favicon.png',
} as const
