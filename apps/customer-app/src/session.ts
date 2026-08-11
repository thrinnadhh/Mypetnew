import * as SecureStore from 'expo-secure-store'
import { runtimeConfig } from './runtime'

const sessionKey = 'mypet.customer.session.v1'

export interface CustomerSession {
  readonly accessToken: string
  readonly refreshToken: string
  readonly tokenType: 'Bearer'
  readonly accessTokenExpiresAt: string
  readonly refreshTokenExpiresAt: string
  readonly role: 'CUSTOMER'
  readonly mobile: string
}

interface SessionPayload {
  readonly accessToken: string
  readonly refreshToken: string
  readonly tokenType: string
  readonly accessTokenExpiresAt: string
  readonly refreshTokenExpiresAt: string
  readonly role: string
}

export class CustomerAuthenticationRequiredError extends Error {
  constructor() {
    super('Customer authentication is required')
    this.name = 'CustomerAuthenticationRequiredError'
  }
}

export async function saveCustomerSession(payload: SessionPayload, mobile: string): Promise<CustomerSession> {
  if (payload.tokenType !== 'Bearer' || payload.role !== 'CUSTOMER') {
    throw new Error('Unexpected customer session response')
  }
  const session: CustomerSession = {
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken,
    tokenType: 'Bearer',
    accessTokenExpiresAt: payload.accessTokenExpiresAt,
    refreshTokenExpiresAt: payload.refreshTokenExpiresAt,
    role: 'CUSTOMER',
    mobile
  }
  await SecureStore.setItemAsync(sessionKey, JSON.stringify(session))
  return session
}

export async function loadCustomerSession(): Promise<CustomerSession | null> {
  const raw = await SecureStore.getItemAsync(sessionKey)
  if (raw === null) return null
  try {
    const parsed = JSON.parse(raw) as CustomerSession
    if (
      parsed.tokenType !== 'Bearer' ||
      parsed.role !== 'CUSTOMER' ||
      typeof parsed.accessToken !== 'string' ||
      typeof parsed.refreshToken !== 'string' ||
      typeof parsed.mobile !== 'string'
    ) {
      await clearCustomerSession()
      return null
    }
    return parsed
  } catch {
    await clearCustomerSession()
    return null
  }
}

export async function clearCustomerSession(): Promise<void> {
  await SecureStore.deleteItemAsync(sessionKey)
}

export async function authenticatedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const session = await loadCustomerSession()
  if (session === null) throw new CustomerAuthenticationRequiredError()

  const first = await fetch(`${runtimeConfig.apiUrl}${path}`, withBearer(init, session.accessToken))
  if (first.status !== 401) return first

  const refreshResponse = await fetch(`${runtimeConfig.apiUrl}/api/v1/auth/sessions/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken: session.refreshToken })
  })
  if (!refreshResponse.ok) {
    await clearCustomerSession()
    throw new CustomerAuthenticationRequiredError()
  }

  const refreshed = await refreshResponse.json() as SessionPayload
  const rotated = await saveCustomerSession(refreshed, session.mobile)
  return fetch(`${runtimeConfig.apiUrl}${path}`, withBearer(init, rotated.accessToken))
}

function withBearer(init: RequestInit, accessToken: string): RequestInit {
  const headers = new Headers(init.headers)
  headers.set('authorization', `Bearer ${accessToken}`)
  return { ...init, headers }
}
