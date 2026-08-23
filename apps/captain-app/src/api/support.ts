import { captainApiFetch, handleApiResponse } from './client';

export type SupportCategory =
  | 'ACTIVE_DELIVERY'
  | 'PAYMENT_EARNINGS'
  | 'ACCOUNT_KYC'
  | 'APP_PROBLEM'
  | 'OTHER';

export interface SupportTicketRequest {
  category: SupportCategory;
  subject: string;
  description: string;
  jobId?: string | null;
  orderReference?: string | null;
}

export interface SupportTicketResponse {
  ticketId: string;
  status: 'OPEN' | 'RESOLVED';
  createdAt: string;
}

export async function createSupportTicket(
  request: SupportTicketRequest,
): Promise<SupportTicketResponse> {
  const response = await captainApiFetch('/api/v1/captain/support/tickets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    timeoutMs: 8000,
  });
  return await handleApiResponse<SupportTicketResponse>(response);
}
