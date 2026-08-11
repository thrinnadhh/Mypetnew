import { describe, expect, it } from 'vitest'
import { allowedAdminRoute } from './authorization'

describe('Admin route authorization', () => {
  it('requires canonical ADMIN plus the route permission', () => {
    expect(allowedAdminRoute({ role: 'ADMIN', permissions: ['PROVIDER_REVIEW'] }, '/providers')).toBe(true)
    expect(allowedAdminRoute({ role: 'ADMIN', permissions: ['AUDIT_VIEW'] }, '/providers')).toBe(false)
    expect(allowedAdminRoute({ role: 'MERCHANT', permissions: ['PROVIDER_REVIEW'] }, '/providers')).toBe(false)
  })
})

