import type { AdminPermission, CanonicalRole } from '@mypet/api-contracts'

export interface AdminPrincipal {
  readonly role: CanonicalRole
  readonly permissions: readonly AdminPermission[]
}

const routePermission: Readonly<Record<string, AdminPermission>> = {
  '/providers': 'PROVIDER_REVIEW',
  '/captains': 'CAPTAIN_REVIEW',
  '/orders': 'ORDER_OPERATIONS',
  '/audit': 'AUDIT_VIEW',
  '/access': 'ADMIN_ACCESS_MANAGER'
}

export function allowedAdminRoute(principal: AdminPrincipal, route: string): boolean {
  if (principal.role !== 'ADMIN') return false
  const permission = routePermission[route]
  return permission !== undefined && principal.permissions.includes(permission)
}

