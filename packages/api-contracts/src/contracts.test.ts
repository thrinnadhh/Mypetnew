import { describe, expect, it } from 'vitest'
import {
  assertSafeRoute,
  assertSafeResourceId,
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
    expect(() => assertSafeRoute('javascript:alert(1)')).toThrow('route')
    expect(() => assertSafeRoute('admin/customers')).toThrow('route')
    expect(assertSafeResourceId('123e4567-e89b-12d3-a456-426614174000')).toContain('123e4567')
    expect(() => assertSafeResourceId('../admin')).toThrow('identifier')
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
    expect(isApiErrorEnvelope(null)).toBe(false)
    expect(isApiErrorEnvelope([])).toBe(false)
    expect(isApiErrorEnvelope({ code: 500 })).toBe(false)
    expect(isApiErrorEnvelope({ code: 'X', message: 4 })).toBe(false)
    expect(isApiErrorEnvelope({ code: 'X', message: 'x', traceId: 7 })).toBe(false)
    expect(isApiErrorEnvelope({ code: 'X', message: 'x', traceId: 't', fieldErrors: [] })).toBe(false)
    expect(isApiErrorEnvelope({
      code: 'X', message: 'x', traceId: 't', fieldErrors: { field: 7 }, timestamp: 'now', path: '/'
    })).toBe(false)
    expect(isApiErrorEnvelope({
      code: 'X', message: 'x', traceId: 't', fieldErrors: {}, timestamp: 7, path: '/'
    })).toBe(false)
    expect(isApiErrorEnvelope({
      code: 'X', message: 'x', traceId: 't', fieldErrors: {}, timestamp: 'now', path: 7
    })).toBe(false)
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

  it('validates environment transport and Firebase identifiers', () => {
    expect(() => requirePublicRuntimeConfig({
      environment: 'staging', apiUrl: 'http://api.example.com', firebaseProjectId: 'staging', firebaseAppId: 'app'
    })).toThrow('HTTPS')
    expect(() => requirePublicRuntimeConfig({
      environment: 'production', apiUrl: 'https://api.example.com', firebaseProjectId: 'prod'
    })).toThrow('Firebase')
    expect(() => requirePublicRuntimeConfig({
      environment: 'production', apiUrl: 'https://api.example.com', firebaseAppId: 'app'
    })).toThrow('Firebase')
    expect(() => requirePublicRuntimeConfig({
      environment: 'development', apiUrl: 'http://localhost:8080/', firebaseProjectId: 'dev', firebaseAppId: 'app'
    })).not.toThrow()
    expect(requirePublicRuntimeConfig({
      environment: 'staging', apiUrl: 'https://api.example.com/', firebaseProjectId: 'staging', firebaseAppId: 'app'
    }).apiUrl).toBe('https://api.example.com')
    expect(() => requirePublicRuntimeConfig({
      environment: 'production', apiUrl: 'https://api.example.com', firebaseProjectId: 'prod', firebaseAppId: 'app', databaseUrl: 'forbidden'
    })).toThrow('server credential')
  })
})
