let mockUuidCount = 1;

jest.mock("expo-crypto", () => ({
  randomUUID: jest.fn(() => `00000000-0000-4000-8000-${String(mockUuidCount++).padStart(12, '0')}`)
}));

const mockSecureStoreMap = new Map();

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (key) => mockSecureStoreMap.get(key) ?? null),
  setItemAsync: jest.fn(async (key, value) => {
    mockSecureStoreMap.set(key, String(value));
  }),
  deleteItemAsync: jest.fn(async (key) => {
    mockSecureStoreMap.delete(key);
  }),
}));

const mockSQLiteStorageMap = new Map();

jest.mock("expo-sqlite/kv-store", () => ({
  SQLiteStorage: class MockSQLiteStorage {
    async getItem(key) {
      return mockSQLiteStorageMap.get(key) ?? null;
    }

    async setItem(key, value) {
      mockSQLiteStorageMap.set(key, String(value));
    }

    async removeItem(key) {
      mockSQLiteStorageMap.delete(key);
    }

    async clear() {
      mockSQLiteStorageMap.clear();
    }
  },
}));

const mockDefinedTasks = new Map();

jest.mock("expo-task-manager", () => ({
  defineTask: jest.fn((taskName, executor) => {
    mockDefinedTasks.set(taskName, executor);
  }),
  isTaskRegisteredAsync: jest.fn().mockImplementation(async (taskName) => {
    return mockDefinedTasks.has(taskName);
  }),
  unregisterTaskAsync: jest.fn().mockImplementation(async (taskName) => {
    mockDefinedTasks.delete(taskName);
  }),
}));

let mockIsLocationUpdatesActive = false;

jest.mock("expo-location", () => ({
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: "granted", granted: true, canAskAgain: true }),
  requestBackgroundPermissionsAsync: jest.fn().mockResolvedValue({ status: "granted", granted: true, canAskAgain: true }),
  getForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: "granted", granted: true, canAskAgain: true }),
  getBackgroundPermissionsAsync: jest.fn().mockResolvedValue({ status: "granted", granted: true, canAskAgain: true }),
  getCurrentPositionAsync: jest.fn().mockResolvedValue({
    coords: {
      latitude: 13.6288,
      longitude: 79.4192,
      accuracy: 10,
      heading: 90,
      speed: 15,
    },
    timestamp: Date.now(),
  }),
  hasServicesEnabledAsync: jest.fn().mockResolvedValue(true),
  startLocationUpdatesAsync: jest.fn().mockImplementation(async () => {
    mockIsLocationUpdatesActive = true;
  }),
  stopLocationUpdatesAsync: jest.fn().mockImplementation(async () => {
    mockIsLocationUpdatesActive = false;
  }),
  hasStartedLocationUpdatesAsync: jest.fn().mockImplementation(async () => {
    return mockIsLocationUpdatesActive;
  }),
  Accuracy: {
    Lowest: 1,
    Low: 2,
    Balanced: 3,
    High: 4,
    Highest: 5,
    BestForNavigation: 6,
  },
}));

jest.mock("expo-linking", () => ({
  openURL: jest.fn().mockResolvedValue(true),
  canOpenURL: jest.fn().mockResolvedValue(true),
  createURL: jest.fn((path) => `mypetcaptain://${path}`),
}));

jest.mock("expo-notifications", () => ({
  AndroidImportance: { MAX: 5 },
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn().mockResolvedValue(null),
  getPermissionsAsync: jest.fn().mockResolvedValue({ status: "granted", granted: true }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: "granted", granted: true }),
  getDevicePushTokenAsync: jest.fn().mockResolvedValue({ type: "android", data: "test-native-token" }),
  addPushTokenListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponseAsync: jest.fn().mockResolvedValue(null),
  clearLastNotificationResponseAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("expo-network", () => ({
  getNetworkStateAsync: jest.fn().mockResolvedValue({
    type: "WIFI",
    isConnected: true,
    isInternetReachable: true,
  }),
  addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })),
  NetworkStateType: {
    NONE: "NONE",
    UNKNOWN: "UNKNOWN",
    CELLULAR: "CELLULAR",
    WIFI: "WIFI",
  },
}));
