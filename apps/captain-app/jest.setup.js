let mockUuidCount = 1;

jest.mock("expo-crypto", () => ({
  randomUUID: jest.fn(() => `00000000-0000-4000-8000-${String(mockUuidCount++).padStart(12, '0')}`)
}));

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn()
}));

jest.mock("expo-location", () => ({
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: "granted", granted: true }),
  requestBackgroundPermissionsAsync: jest.fn().mockResolvedValue({ status: "granted", granted: true }),
  getForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: "granted", granted: true }),
  getBackgroundPermissionsAsync: jest.fn().mockResolvedValue({ status: "granted", granted: true }),
  getCurrentPositionAsync: jest.fn().mockResolvedValue({
    coords: {
      latitude: 13.6288,
      longitude: 79.4192,
      accuracy: 10,
    },
    timestamp: Date.now(),
  }),
  hasServicesEnabledAsync: jest.fn().mockResolvedValue(true),
  Accuracy: {
    High: 4,
    Balanced: 3,
  },
}));

jest.mock("expo-linking", () => ({
  openURL: jest.fn().mockResolvedValue(true),
  canOpenURL: jest.fn().mockResolvedValue(true),
  createURL: jest.fn((path) => `mypetcaptain://${path}`),
}));
