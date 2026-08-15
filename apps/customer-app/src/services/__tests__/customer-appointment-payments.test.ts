import { apiClient } from '../api-client';
import {
  initiateAppointmentPayment,
  waitForReferencePaymentOutcome,
} from '../customer-payments';

jest.mock('../api-client', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

const mockedApiClient = apiClient as jest.Mocked<typeof apiClient>;

describe('customer appointment payments remain fail-closed in Plan 5', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not revive the legacy client-authored appointment payment request', async () => {
    await expect(initiateAppointmentPayment('user-1', 'appointment/1', 799, {
      phone: '919876543210',
      email: null,
      name: null,
    })).rejects.toThrow('Appointment online payment is not available until Plan 8.');

    expect(mockedApiClient.post).not.toHaveBeenCalled();
    expect(mockedApiClient.get).not.toHaveBeenCalled();
  });

  it('does not poll the legacy appointment transaction endpoint', async () => {
    await expect(waitForReferencePaymentOutcome('appointment/1')).rejects.toThrow(
      'Appointment online payment is not available until Plan 8.',
    );

    expect(mockedApiClient.get).not.toHaveBeenCalled();
    expect(mockedApiClient.post).not.toHaveBeenCalled();
  });

  it('contains no Plan-5 runtime path that accepts appointment amount or success from the Customer', async () => {
    await expect(initiateAppointmentPayment('foreign-user', 'foreign-appointment', 1)).rejects.toThrow(
      'Appointment online payment is not available until Plan 8.',
    );

    expect(mockedApiClient.post).not.toHaveBeenCalled();
  });
});
