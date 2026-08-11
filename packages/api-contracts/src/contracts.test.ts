import { describe, expect, it } from 'vitest'
import {
  assertSafeRoute,
  formatInrPaise,
  isApiErrorEnvelope,
  requirePublicRuntimeConfig
} from './index'

describe('shared API contracts', () => {
  it('formats integer paise for display without changing the transaction value', () => {
    expect(formatInrPaise(12_500)).toBe('₹125.00')
    expect(() => formatInrPaise(-1)).toThrow('non-negative integer paise')
    expect(() => formatInrPaise(12.5)).toThrow('non-negative integer paise')
  })

  it('accepts only allowlisted notification routes', () => {
    expect(assertSafeRoute('merchant/orders/detail')).toBe('merchant/orders/detail')
    expect(() => assertSafeRoute('https://evil.example')).toThrow('route')
    expect(() => assertSafeRoute('../admin')).toThrow('route')
  })

  it('recognizes the stable API error envelope', () => {
    expect(isApiErrorEnvelope({
      code: 'QUOTE_EXPIRED',
      message: 'The quote expired',
      traceId: 'trace-1',
      fieldErrors: {},
      timestamp: '2026-08-11T12:00:00Z',
      path: '/api/v1/orders'
    })).toBe(true)
    expect(isApiErrorEnvelope({ message: 'raw exception' })).toBe(false)
  })

  it('production runtime never falls back to mock API or server credentials', () => {
    expect(() => requirePublicRuntimeConfig({ environment: 'production' })).toThrow('API URL')
    expect(() => requirePublicRuntimeConfig({
      environment: 'production',
      apiUrl: 'https://api.example.com',
      firebaseProjectId: 'prod-project',
      firebaseServerPrivateKey: 'forbidden'
    })).toThrow('server credential')
  })
})

