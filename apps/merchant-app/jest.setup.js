const mockNodeCrypto = require('crypto');

let mockUuidCounter = 0;

jest.mock("expo-crypto", () => ({
  randomUUID: jest.fn(() => {
    mockUuidCounter += 1;
    return `00000000-0000-4000-8000-${String(mockUuidCounter).padStart(12, '0')}`;
  }),
  CryptoDigestAlgorithm: {
    SHA256: 'SHA-256',
    SHA384: 'SHA-384',
    SHA512: 'SHA-512',
    MD5: 'MD5',
  },
  digestStringAsync: jest.fn(async (algorithm, data) => {
    const algo = (algorithm || 'SHA-256').toLowerCase().replace('-', '');
    return mockNodeCrypto.createHash(algo === 'sha256' ? 'sha256' : algo).update(data).digest('hex');
  }),
}));

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn()
}));
