import {
  BACKEND_CAPABILITIES,
  CapabilityUnavailableError,
  assertCapabilityAvailable,
  isCapabilityAvailable,
  type BackendCapabilityId,
} from '../backend-capabilities';

const globalWithDev = globalThis as typeof globalThis & { __DEV__?: boolean };
const realDev = globalWithDev.__DEV__;

afterEach(() => {
  globalWithDev.__DEV__ = realDev;
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('EXPO_PUBLIC_ENABLE_')) delete process.env[key];
  }
});

describe('backend capability registry', () => {
  it('starts every deferred backend capability as unavailable', () => {
    const ids: BackendCapabilityId[] = [
      'medicalDocuments',
      'supportCases',
      'chat',
      'contentEngagement',
      'vaccinationReminders',
      'localeSync',
    ];
    expect(ids).toEqual(Object.keys(BACKEND_CAPABILITIES));
    for (const id of ids) {
      expect(BACKEND_CAPABILITIES[id].available).toBe(false);
      expect(BACKEND_CAPABILITIES[id].envOverride).toMatch(/^EXPO_PUBLIC_ENABLE_[A-Z_]+$/);
    }
  });

  it('honours dev-only env overrides and always fails closed in release builds', () => {
    globalWithDev.__DEV__ = true;
    process.env.EXPO_PUBLIC_ENABLE_MEDICAL_DOCUMENTS = 'true';
    expect(isCapabilityAvailable('medicalDocuments')).toBe(true);

    delete process.env.EXPO_PUBLIC_ENABLE_MEDICAL_DOCUMENTS;
    expect(isCapabilityAvailable('medicalDocuments')).toBe(false);
    process.env.EXPO_PUBLIC_ENABLE_MEDICAL_DOCUMENTS = '1';
    expect(isCapabilityAvailable('medicalDocuments')).toBe(true);

    globalWithDev.__DEV__ = false;
    process.env.EXPO_PUBLIC_ENABLE_CHAT = 'true';
    expect(isCapabilityAvailable('chat')).toBe(false);
  });

  it('throws a typed CapabilityUnavailableError carrying the capability id', () => {
    let thrown: unknown;
    try {
      assertCapabilityAvailable('supportCases');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(CapabilityUnavailableError);
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).toMatchObject({ name: 'CapabilityUnavailableError', capabilityId: 'supportCases' });
    expect(() => assertCapabilityAvailable('chat')).toThrow(/chat/);
  });
});
