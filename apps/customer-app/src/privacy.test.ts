import { afterEach, describe, expect, it, vi } from 'vitest'
import { deleteCustomerAccount, grantConsent, withdrawConsent } from './privacy'

const config = {
  environment: 'production' as const,
  apiUrl: 'https://api.mypet.example',
  firebaseProjectId: 'mypet-production',
  firebaseAppId: 'public-app-id'
}

afterEach(() => vi.unstubAllGlobals())

describe('Customer Privacy Centre client', () => {
  it('grants and withdraws a purpose without accepting a customer identifier', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ consentId: 'c1', purpose: 'MARKETING' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ consentId: 'c1', purpose: 'MARKETING', withdrawnAt: 'now' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await grantConsent(config, 'access-secret', 'MARKETING')
    await withdrawConsent(config, 'access-secret', 'MARKETING')

    expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://api.mypet.example/api/v1/privacy/consents/MARKETING', expect.objectContaining({ method: 'PUT' }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://api.mypet.example/api/v1/privacy/consents/MARKETING', expect.objectContaining({ method: 'DELETE' }))
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('customerId')
  })

  it('requires an authenticated self-service deletion route and explicit confirmation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'DIRECT_IDENTIFIERS_ERASED' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await deleteCustomerAccount(config, 'access-secret')

    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.mypet.example/api/v1/privacy/account')
    expect(request.method).toBe('DELETE')
    expect(request.body).toBe(JSON.stringify({ confirmation: 'DELETE' }))
    expect(url).not.toContain('customerId')
  })
})
