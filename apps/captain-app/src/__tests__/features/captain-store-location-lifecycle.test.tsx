import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { AppState, AppStateStatus } from 'react-native';
import { useAuth } from '../../auth/context';
import { locationUploader } from '../../location/location-uploader';
import {
  CaptainStoreContextType,
  CaptainStoreProvider,
  useCaptainStore,
} from '../../state/captain-store';

jest.mock('../../auth/context', () => ({
  useAuth: jest.fn(),
}));

jest.mock('../../location/location-uploader', () => ({
  locationUploader: {
    startTracking: jest.fn(),
    stopTracking: jest.fn(),
    publishCurrentLocation: jest.fn().mockResolvedValue(null),
  },
}));

jest.mock('../../sync/connectivity', () => ({
  connectivity: {
    online: true,
    subscribe: jest.fn(() => () => {}),
  },
}));

async function flushEffects(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('Captain store busy-delivery location recovery', () => {
  let appStateHandler: ((state: AppStateStatus) => void) | undefined;
  let latestStore: CaptainStoreContextType | null = null;
  let appStateSpy: jest.SpyInstance;

  function Probe() {
    latestStore = useCaptainStore();
    return null;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    latestStore = null;
    appStateHandler = undefined;
    (useAuth as jest.Mock).mockReturnValue({
      session: {
        accountId: 'captain-busy-resume',
        role: 'CAPTAIN',
      },
      isAuthenticated: true,
      captainProfile: {
        captainId: 'captain-busy-resume',
        mobile: '+919999999999',
        status: 'ACTIVE',
        approved: true,
        online: false,
        busy: true,
        vehicle: { type: 'BIKE', verified: true },
        bank: { verified: true },
      },
    });
    appStateSpy = jest.spyOn(AppState, 'addEventListener').mockImplementation((
      event: string,
      listener: (state: AppStateStatus) => void,
    ) => {
      if (event === 'change') appStateHandler = listener;
      return { remove: jest.fn() } as any;
    });
  });

  afterEach(() => {
    appStateSpy.mockRestore();
  });

  it('refreshes a busy Captain location even when presence.online is false', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <CaptainStoreProvider>
          <Probe />
        </CaptainStoreProvider>,
      );
      await flushEffects();
    });

    expect(locationUploader.startTracking).toHaveBeenCalledWith(false, true);
    expect(latestStore?.availabilityState).toBe('BUSY');

    (locationUploader.publishCurrentLocation as jest.Mock).mockClear();
    await act(async () => {
      await latestStore!.refreshPresence();
    });
    expect(locationUploader.publishCurrentLocation).toHaveBeenCalledWith(false);

    (locationUploader.publishCurrentLocation as jest.Mock).mockClear();
    await act(async () => {
      appStateHandler?.('active');
      await flushEffects();
    });

    expect(locationUploader.publishCurrentLocation).toHaveBeenCalledWith(false);
    expect(latestStore?.locationActivityState).toBe('FOREGROUND_TRACKING');

    await act(async () => {
      renderer.unmount();
    });
  });
});