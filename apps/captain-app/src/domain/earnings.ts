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
