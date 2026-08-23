import { commandStore } from './command-store';
import { connectivity } from './connectivity';

export class ReconciliationService {
  private isReconciling = false;

  constructor() {
    connectivity.subscribe((online) => {
      if (online) {
        this.reconcile();
      }
    });
  }

  async reconcile(): Promise<void> {
    if (this.isReconciling) return;
    this.isReconciling = true;

    try {
      const pending = await commandStore.listPending();
      for (const cmd of pending) {
        if (cmd.state === 'UNKNOWN') {
          cmd.state = 'REQUIRES_RECONCILIATION';
          cmd.updatedAt = new Date().toISOString();
          await commandStore.save(cmd);
        }
      }
    } finally {
      this.isReconciling = false;
    }
  }
}

export const reconciliationService = new ReconciliationService();
