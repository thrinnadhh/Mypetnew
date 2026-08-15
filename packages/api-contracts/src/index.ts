export type CanonicalRole = 'CUSTOMER' | 'MERCHANT' | 'CAPTAIN' | 'ADMIN'

export type AdminPermission =
  | 'PROVIDER_REVIEW'
  | 'CAPTAIN_REVIEW'
  | 'CATALOG_MODERATION'
  | 'ORDER_OPERATIONS'
  | 'DISPATCH_OPERATIONS'
  | 'PAYMENT_OPERATIONS'
  | 'REFUND_APPROVER'
  | 'SUPPORT_OPERATIONS'
  | 'CONTENT_MANAGER'
  | 'CITY_MANAGER'
  | 'FINANCE_VIEW'
  | 'AUDIT_VIEW'
  | 'ADMIN_ACCESS_MANAGER'

export type SafeRoute =
  | 'customer/loyalty'
  | 'customer/orders/detail'
  | 'merchant/orders/detail'
  | 'captain/offers/detail'
  | 'inbox'

const safeRoutes: ReadonlySet<string> = new Set<SafeRoute>([
  'customer/loyalty',
  'customer/orders/detail',
  'merchant/orders/detail',
  'captain/offers/detail',
  'inbox'
])

export interface ApiErrorEnvelope {
  readonly code: string
  readonly message: string
  readonly traceId: string
  readonly fieldErrors: Readonly<Record<string, string>>
  readonly timestamp: string
  readonly path: string
}

export interface RuntimeConfigInput {
  readonly environment: 'development' | 'staging' | 'production'
  readonly apiUrl?: string
  readonly firebaseProjectId?: string
  readonly firebaseAppId?: string
  readonly firebaseServerPrivateKey?: string
  readonly supabaseServiceRoleKey?: string
  readonly databaseUrl?: string
}

export interface PublicRuntimeConfig {
  readonly environment: RuntimeConfigInput['environment']
  readonly apiUrl: string
  readonly firebaseProjectId: string
  readonly firebaseAppId: string
}

export interface DeviceRegistrationRequest {
  readonly appKind: 'CUSTOMER' | 'MERCHANT' | 'CAPTAIN'
  readonly environment: PublicRuntimeConfig['environment']
  readonly installationId: string
  readonly platform: 'ANDROID' | 'IOS'
  readonly nativeToken: string
  readonly permissionState: 'GRANTED' | 'DENIED'
}

export function formatInrPaise(paise: number): string {
  if (!Number.isSafeInteger(paise) || paise < 0) {
    throw new Error('Money must be expressed as non-negative integer paise')
  }
  const rupees = Math.floor(paise / 100)
  const subunit = String(paise % 100).padStart(2, '0')
  return `₹${rupees.toLocaleString('en-IN')}.${subunit}`
}

export function assertSafeRoute(value: string): SafeRoute {
  if (!safeRoutes.has(value)) throw new Error('Notification route is not allowlisted')
  return value as SafeRoute
}

export function assertSafeResourceId(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error('Notification resource identifier is invalid')
  }
  return value
}

export function isApiErrorEnvelope(value: unknown): value is ApiErrorEnvelope {
  if (!isRecord(value)) return false
  return typeof value.code === 'string' &&
    typeof value.message === 'string' &&
    typeof value.traceId === 'string' &&
    isRecord(value.fieldErrors) &&
    Object.values(value.fieldErrors).every((entry) => typeof entry === 'string') &&
    typeof value.timestamp === 'string' &&
    typeof value.path === 'string'
}

export function requirePublicRuntimeConfig(input: RuntimeConfigInput): PublicRuntimeConfig {
  if (input.firebaseServerPrivateKey || input.supabaseServiceRoleKey || input.databaseUrl) {
    throw new Error('A server credential must never be included in a client runtime')
  }
  if (!input.apiUrl) throw new Error('API URL is required; mock fallback is disabled')
  if (!/^https:\/\//.test(input.apiUrl) && input.environment !== 'development') {
    throw new Error('Non-development API URL must use HTTPS')
  }
  if (!input.firebaseProjectId || !input.firebaseAppId) {
    throw new Error('Environment-specific Firebase public identifiers are required')
  }
  return {
    environment: input.environment,
    apiUrl: input.apiUrl.replace(/\/$/, ''),
    firebaseProjectId: input.firebaseProjectId,
    firebaseAppId: input.firebaseAppId
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
