import * as Notifications from 'expo-notifications'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'
import {
  assertSafeRoute,
  assertSafeResourceId,
  type DeviceRegistrationRequest,
  type PublicRuntimeConfig,
  type SafeRoute
} from '@mypet/api-contracts'

const installationKey = 'mypet.installation-id.v1'

export async function registerNativePush(
  config: PublicRuntimeConfig,
  appKind: DeviceRegistrationRequest['appKind'],
  accessToken: string
): Promise<'ACTIVE' | 'DENIED'> {
  const current = await Notifications.getPermissionsAsync()
  const permission = current.granted ? current : await Notifications.requestPermissionsAsync()
  const installationId = await getNativeInstallationId()
  if (!permission.granted) {
    await postRegistration(config, accessToken, {
      appKind,
      environment: config.environment,
      installationId,
      platform: platform(),
      nativeToken: '',
      permissionState: 'DENIED'
    })
    return 'DENIED'
  }
  const token = await Notifications.getDevicePushTokenAsync()
  await postRegistration(config, accessToken, {
    appKind,
    environment: config.environment,
    installationId,
    platform: platform(),
    nativeToken: String(token.data),
    permissionState: 'GRANTED'
  })
  return 'ACTIVE'
}

export function subscribeToSafeNotificationRoutes(
  navigate: (route: SafeRoute, resourceId: string) => void
): Notifications.EventSubscription {
  return Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data
    if (!data || typeof data.route !== 'string' || typeof data.resourceId !== 'string') return
    try {
      navigate(assertSafeRoute(data.route), assertSafeResourceId(data.resourceId))
    } catch {
      navigate('inbox', '')
    }
  })
}

export async function unregisterNativePush(
  config: PublicRuntimeConfig,
  appKind: DeviceRegistrationRequest['appKind'],
  accessToken: string
): Promise<void> {
  const installationId = await SecureStore.getItemAsync(installationKey)
  if (!installationId) return
  const query = new URLSearchParams({ appKind, environment: config.environment }).toString()
  const response = await fetch(
    `${config.apiUrl}/api/v1/devices/registrations/${encodeURIComponent(installationId)}?${query}`,
    { method: 'DELETE', headers: { authorization: `Bearer ${accessToken}` } }
  )
  if (!response.ok && response.status !== 404) throw new Error('Device unregister failed')
}

async function postRegistration(
  config: PublicRuntimeConfig,
  accessToken: string,
  request: DeviceRegistrationRequest
): Promise<void> {
  const response = await fetch(`${config.apiUrl}/api/v1/devices/registrations`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      'idempotency-key': `device-${request.installationId}`
    },
    body: JSON.stringify(request)
  })
  if (!response.ok) throw new Error('Device registration failed')
}

export async function getNativeInstallationId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(installationKey)
  if (existing) return existing
  const value = globalThis.crypto.randomUUID()
  await SecureStore.setItemAsync(installationKey, value)
  return value
}

function platform(): DeviceRegistrationRequest['platform'] {
  return Platform.OS === 'ios' ? 'IOS' : 'ANDROID'
}
