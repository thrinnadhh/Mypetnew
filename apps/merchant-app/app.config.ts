import type { ConfigContext, ExpoConfig } from 'expo/config'
import { env } from 'node:process'

const environment = resolveEnvironment(readEnv('APP_ENV'))

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'MyPet Merchant',
  slug: 'mypetnew-merchant',
  scheme: 'mypet-merchant',
  version: '0.1.0',
  orientation: 'default',
  userInterfaceStyle: 'automatic',
  plugins: ['expo-router', 'expo-notifications', 'expo-secure-store', ['expo-camera', { cameraPermission: 'Scan product barcodes for your outlet catalog, inventory, and POS.' }]],
  experiments: { typedRoutes: true },
  android: {
    package: `in.mypetnew.merchant${environment === 'production' ? '' : `.${environment}`}`,
    googleServicesFile: readEnv('GOOGLE_SERVICES_JSON')
  },
  ios: {
    bundleIdentifier: `in.mypetnew.merchant${environment === 'production' ? '' : `.${environment}`}`,
    googleServicesFile: readEnv('GOOGLE_SERVICES_PLIST'),
    supportsTablet: true
  },
  extra: {
    environment,
    apiUrl: readEnv('EXPO_PUBLIC_API_URL') ?? 'http://127.0.0.1:8080',
    firebaseProjectId: readEnv('EXPO_PUBLIC_FIREBASE_PROJECT_ID') ?? 'mypetnew-development',
    firebaseAppId: readEnv('EXPO_PUBLIC_FIREBASE_APP_ID') ?? 'development-build-not-registered'
  }
})

function resolveEnvironment(value: string | undefined): 'development' | 'staging' | 'production' {
  if (value === undefined || value === 'development') return 'development'
  if (value === 'staging' || value === 'production') return value
  throw new Error('APP_ENV is invalid')
}

function readEnv(name: string): string | undefined {
  const value: unknown = env[name]
  return typeof value === 'string' ? value : undefined
}
