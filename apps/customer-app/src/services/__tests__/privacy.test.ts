import { apiClient } from '../api-client';
import {
  deleteCustomerAccount,
  grantConsent,
  updatePrivacyProfile,
  withdrawConsent,
} from '../privacy';

describe('Customer privacy service', () => {
  afterEach(() => jest.restoreAllMocks());

  it('binds consent grant and withdrawal to the authenticated self-service routes', async () => {
    const put = jest.spyOn(apiClient, 'put').mockResolvedValue({});
    const remove = jest.spyOn(apiClient, 'delete').mockResolvedValue({});

    await grantConsent('MARKETING');
    await withdrawConsent('MARKETING');

    expect(put).toHaveBeenCalledWith('/api/v1/privacy/consents/MARKETING', {
      noticeVersion: 'privacy-v1',
      source: 'CUSTOMER_APP',
    });
    expect(remove).toHaveBeenCalledWith('/api/v1/privacy/consents/MARKETING');
    expect(JSON.stringify([...put.mock.calls, ...remove.mock.calls])).not.toContain('customerId');
  });

  it('does not create adult eligibility evidence through ordinary profile correction', async () => {
    const patch = jest.spyOn(apiClient, 'patch').mockResolvedValue({});

    await updatePrivacyProfile('Customer A', 'customer.a@example.com');

    expect(patch).toHaveBeenCalledWith('/api/v1/privacy/me', {
      displayName: 'Customer A',
      email: 'customer.a@example.com',
    });
    expect(JSON.stringify(patch.mock.calls)).not.toContain('adultEligibilityAttested');
  });

  it('requires the exact self-service deletion route and confirmation', async () => {
    const request = jest.spyOn(apiClient, 'request').mockResolvedValue({});

    await deleteCustomerAccount();

    expect(request).toHaveBeenCalledWith('/api/v1/privacy/account', {
      method: 'DELETE',
      body: { confirmation: 'DELETE' },
    });
  });
});
