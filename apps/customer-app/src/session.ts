import * as SecureStore from 'expo-secure-store'
import { unregisterNativePush } from '@mypet/mobile-notifications'
import type { PublicRuntimeConfig } from '@mypet/api-contracts'

const accessTokenKey = 'mypet.customer.access-token.v1'
const refreshTokenKey = 'mypet.customer.refresh-token.v1'

export interface CustomerSession {
  readonly accessToken: string
  readonly refreshToken: string
}

export async function saveCustomerSession(session: CustomerSession): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(accessTokenKey, session.accessToken),
    SecureStore.setItemAsync(refreshTokenKey, session.refreshToken)
  ])
}

export async function loadAccessToken(): Promise<string | null> {
  return SecureStore.getItemAsync(accessTokenKey)
}

export async function logoutCustomer(config: PublicRuntimeConfig): Promise<void> {
  const accessToken = await SecureStore.getItemAsync(accessTokenKey)
  try {
    if (accessToken) {
      await unregisterNativePush(config, 'CUSTOMER', accessToken).catch(() => undefined)
      await fetch(`${config.apiUrl}/api/v1/auth/sessions/current`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${accessToken}` }
      }).catch(() => undefined)
    }
  } finally {
    await Promise.all([
      SecureStore.deleteItemAsync(accessTokenKey),
      SecureStore.deleteItemAsync(refreshTokenKey)
    ])
  }
}
