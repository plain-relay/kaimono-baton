import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  // Verification identifiers only. Owner must choose production identifiers.
  appId: 'dev.kaimonobaton.preview',
  appName: '買いものバトン',
  webDir: 'dist-native',
  loggingBehavior: 'none',
  server: { androidScheme: 'https' },
  android: { allowMixedContent: false, webContentsDebuggingEnabled: false },
  ios: { contentInset: 'automatic', preferredContentMode: 'mobile' },
}
export default config
