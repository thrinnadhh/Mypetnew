import Constants from 'expo-constants'
import { requirePublicRuntimeConfig, type PublicRuntimeConfig } from '@mypet/api-contracts'

interface ExpoExtra {
  readonly environment?: PublicRuntimeConfig['environment']
  readonly apiUrl?: string
  readonly firebaseProjectId?: string
  readonly firebaseAppId?: string
}

const extra = (Constants.expoConfig?.extra ?? {}) as ExpoExtra

export const runtimeConfig = requirePublicRuntimeConfig({
  environment: extra.environment ?? 'development',
  apiUrl: extra.apiUrl,
  firebaseProjectId: extra.firebaseProjectId,
  firebaseAppId: extra.firebaseAppId
})

