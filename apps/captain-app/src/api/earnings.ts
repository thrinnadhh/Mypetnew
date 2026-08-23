import { captainApiFetch, handleApiResponse } from './client';

export interface CaptainEarning {
  deliveryId: string;
  orderReference: string;
  earningPaise: number;
  incentivePaise?: number;
  adjustmentPaise?: number;
  totalPaise: number;
  status: 'SETTLED' | 'PENDING';
  completedAt: string;
}

export interface Settlement {
  settlementId: string;
  amountPaise: number;
  status: 'PROCESSED' | 'PENDING' | 'FAILED';
  periodStart: string;
  periodEnd: string;
  processedAt?: string | null;
}

export interface CaptainEarningsSummary {
  todayPaise: number;
  todayDeliveryCount: number;
  thisWeekPaise: number;
  thisMonthPaise: number;
  recentEarnings: CaptainEarning[];
  settlements: Settlement[];
}

export async function fetchCaptainEarnings(): Promise<CaptainEarningsSummary> {
  try {
    const response = await captainApiFetch('/api/v1/captain/earnings');
    if (response.ok) {
      return await handleApiResponse<CaptainEarningsSummary>(response);
    }
  } catch {
    // Return graceful initial state
  }

  return {
    todayPaise: 0,
    todayDeliveryCount: 0,
    thisWeekPaise: 0,
    thisMonthPaise: 0,
    recentEarnings: [],
    settlements: [],
  };
}
