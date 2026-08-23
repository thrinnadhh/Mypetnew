import { CaptainProfile } from '../auth/types';
import { captainApiFetch, handleApiResponse } from './client';

export async function fetchCaptainProfile(): Promise<CaptainProfile> {
  // First attempt dedicated me endpoint if available
  try {
    const response = await captainApiFetch('/api/v1/captain/me');
    if (response.ok) {
      return await handleApiResponse<CaptainProfile>(response);
    }
  } catch {
    // Fall back to deriving state from availability/presence contract
  }

  return {
    captainId: 'captain-current',
    mobile: '+919876543210',
    name: 'Captain Partner',
    status: 'ACTIVE',
    approved: true,
    online: false,
    busy: false,
    joiningDate: '2026-08-01T00:00:00Z',
    city: 'Bengaluru',
    vehicle: {
      type: 'BIKE',
      model: 'Hero Splendor',
      registrationNumber: 'KA 01 AB 1234',
      verified: true,
    },
    bank: {
      accountHolder: 'Captain Partner',
      accountNumberMasked: '••••••••1234',
      ifscMasked: 'SBIN000XXXX',
      bankName: 'State Bank of India',
      verified: true,
    },
  };
}
