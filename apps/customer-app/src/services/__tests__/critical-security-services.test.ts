import {
  createRecurringOrder,
  fetchRecurringOrders,
  updateRecurringOrder,
} from '../recurring-orders';
import {
  fetchMedicalDocuments,
  uploadMedicalDocument,
} from '../medical-documents';
import {
  createCustomerCase,
  fetchCustomerCases,
  uploadCustomerCaseEvidence,
  type CustomerCase,
} from '../customer-cases';

jest.mock('@/utils/app-config', () => ({
  appConfig: { apiBaseUrl: 'https://api.mypet.test', allowDemoMode: false },
}));

const mockedFetch = jest.fn();

function response(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  const normalized = new Map(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 400 ? 'Request Failed' : 'OK',
    headers: { get: (name: string) => normalized.get(name.toLowerCase()) ?? null },
    text: jest.fn().mockResolvedValue(typeof body === 'string' ? body : JSON.stringify(body)),
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedFetch.mockReset();
  global.fetch = mockedFetch as unknown as typeof fetch;
});

describe('recurring-order security and failure paths', () => {
  it('surfaces structured authorization failures without retrying mutations', async () => {
    mockedFetch.mockResolvedValueOnce(response({
      code: 'SUBSCRIPTION_FORBIDDEN', message: 'Subscription belongs to another customer',
    }, 403, { 'x-request-id': 'trace-recurring' }));

    await expect(fetchRecurringOrders('token')).rejects.toMatchObject({
      status: 403,
      code: 'SUBSCRIPTION_FORBIDDEN',
      traceId: 'trace-recurring',
    });
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it('sends optional change fields and exposes conflict responses', async () => {
    mockedFetch
      .mockResolvedValueOnce(response({ subscriptionId: 'sub-1', status: 'ACTIVE' }))
      .mockResolvedValueOnce(response({ code: 'SOURCE_ORDER_INVALID', message: 'Order cannot subscribe' }, 409));

    await updateRecurringOrder('sub-1', 'CHANGE', 'token', {
      cadenceDays: 35,
      quantityMultiplier: 3,
      deliveryAddressId: 'address-2',
    });
    expect(JSON.parse(mockedFetch.mock.calls[0][1]?.body as string)).toEqual({
      action: 'CHANGE', cadenceDays: 35, quantityMultiplier: 3, deliveryAddressId: 'address-2',
    });

    await expect(createRecurringOrder('order-1', 7, 1, 'token')).rejects.toMatchObject({
      status: 409,
      code: 'SOURCE_ORDER_INVALID',
    });
  });
});

describe('private medical-document security failures', () => {
  it('rejects foreign document listings with the server trace', async () => {
    mockedFetch.mockResolvedValueOnce(response({
      code: 'MEDICAL_DOCUMENT_FORBIDDEN', message: 'Document access denied',
    }, 403, { 'x-trace-id': 'trace-medical' }));

    await expect(fetchMedicalDocuments('token')).rejects.toMatchObject({
      status: 403,
      code: 'MEDICAL_DOCUMENT_FORBIDDEN',
      traceId: 'trace-medical',
    });
  });

  it('stops when reservation fails and surfaces upload validation failures', async () => {
    mockedFetch.mockResolvedValueOnce(response({
      code: 'APPOINTMENT_FORBIDDEN', message: 'Appointment access denied',
    }, 403));
    await expect(uploadMedicalDocument('appointment-1', {
      uri: 'file:///report.pdf', name: 'report.pdf', mimeType: 'application/pdf',
    }, 'token')).rejects.toMatchObject({ code: 'APPOINTMENT_FORBIDDEN' });
    expect(mockedFetch).toHaveBeenCalledTimes(1);

    mockedFetch
      .mockResolvedValueOnce(response({
        uploadToken: 'upload-token', uploadUrl: 'https://uploads.mypet.test/medical',
        expiresAt: '2026-08-06T12:10:00Z',
      }))
      .mockResolvedValueOnce(response({
        code: 'UPLOAD_TYPE_REJECTED', message: 'Unsupported medical document type',
      }, 422));
    await expect(uploadMedicalDocument('appointment-1', {
      uri: 'file:///script.exe', name: 'script.exe', mimeType: 'application/octet-stream',
    }, 'token')).rejects.toMatchObject({
      status: 422,
      code: 'UPLOAD_TYPE_REJECTED',
    });
  });
});

describe('customer-case evidence security failures', () => {
  const customerCase: CustomerCase = {
    caseId: 'case-1', orderId: 'order-1', customerId: 'customer-1',
    caseType: 'DAMAGED_ITEM', description: 'Damaged', status: 'OPEN',
    refundStatus: 'NOT_APPLICABLE', evidence: [],
    createdAt: '2026-08-06T00:00:00Z', updatedAt: '2026-08-06T00:00:00Z',
  };

  it('rejects foreign case access and case creation against another customer order', async () => {
    mockedFetch
      .mockResolvedValueOnce(response({ code: 'CASE_FORBIDDEN', message: 'Case access denied' }, 403))
      .mockResolvedValueOnce(response({ code: 'ORDER_FORBIDDEN', message: 'Order access denied' }, 403));

    await expect(fetchCustomerCases('token')).rejects.toMatchObject({ code: 'CASE_FORBIDDEN' });
    await expect(createCustomerCase('foreign-order', 'DAMAGED_ITEM', 'Damaged', 'token'))
      .rejects.toMatchObject({ code: 'ORDER_FORBIDDEN' });
  });

  it('does not upload after reservation denial and reports rejected evidence types', async () => {
    mockedFetch.mockResolvedValueOnce(response({
      code: 'CASE_EVIDENCE_FORBIDDEN', message: 'Evidence access denied',
    }, 403));
    await expect(uploadCustomerCaseEvidence(customerCase, {
      uri: 'file:///photo.jpg', name: 'photo.jpg', mimeType: 'image/jpeg',
    }, 'token')).rejects.toMatchObject({ code: 'CASE_EVIDENCE_FORBIDDEN' });
    expect(mockedFetch).toHaveBeenCalledTimes(1);

    mockedFetch
      .mockResolvedValueOnce(response({
        uploadToken: 'upload-token', uploadUrl: 'https://uploads.mypet.test/case',
      }))
      .mockResolvedValueOnce(response({
        code: 'EVIDENCE_TYPE_REJECTED', message: 'Unsupported evidence type',
      }, 422));
    await expect(uploadCustomerCaseEvidence(customerCase, {
      uri: 'file:///payload.exe', name: 'payload.exe', mimeType: 'application/octet-stream',
    }, 'token')).rejects.toMatchObject({ code: 'EVIDENCE_TYPE_REJECTED' });
  });
});
