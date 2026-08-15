from pathlib import Path

path = Path('apps/customer-app/src/__tests__/customer-journey-contracts.test.ts')
text = path.read_text()
old = "    expect(quoteClient).not.toContain('customerId:');\n"
new = '''    const pickupQuoteRequest = quoteClient.slice(\n      quoteClient.indexOf("await apiClient.post<CanonicalProductQuote>('/api/v1/customer/quotes/pickup'"),\n      quoteClient.indexOf("'STORE_PICKUP'", quoteClient.indexOf("await apiClient.post<CanonicalProductQuote>('/api/v1/customer/quotes/pickup'")),\n    );\n    const deliveryQuoteRequest = quoteClient.slice(\n      quoteClient.indexOf("await apiClient.post<CanonicalProductQuote>('/api/v1/customer/quotes/delivery'"),\n      quoteClient.indexOf("'MYPET_CAPTAIN_DELIVERY'", quoteClient.indexOf("await apiClient.post<CanonicalProductQuote>('/api/v1/customer/quotes/delivery'")),\n    );\n    expect(pickupQuoteRequest).not.toContain('customerId');\n    expect(deliveryQuoteRequest).not.toContain('customerId');\n    expect(quoteClient).toContain('customerId: string;');\n'''
if old not in text:
    raise SystemExit('stale quote authority assertion not found')
path.write_text(text.replace(old, new, 1))
