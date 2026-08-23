import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { useAuth } from '../auth/context';
import { CommandOutcome } from '../domain/command';
import {
  DeliveryJob,
  DeliveryProof,
  DeliveryState,
  isDeliveryStateMoreAdvanced,
} from '../domain/delivery';
import { DispatchAssignment, DispatchOffer } from '../domain/dispatch';
import { AppError } from '../domain/result';
import { deliveryRepository } from '../repositories/delivery-repository';
import { dispatchRepository } from '../repositories/dispatch-repository';
import { locationUploader } from '../location/location-uploader';
import { reconciliationService } from '../sync/reconciliation';
import { useCaptainStore } from './captain-store';

interface DeliveryStoreContextType {
  activeDelivery: DeliveryJob | null;
  pendingOffers: DispatchOffer[];
  activeOffer: DispatchOffer | null;
  deliveryState: DeliveryState | null;
  isRespondingOffer: boolean;
  isConfirmingPickup: boolean;
  isConfirmingDelivery: boolean;
  deliveryError: AppError | null;
  lastCommandOutcome: CommandOutcome<any> | null;
  refreshOffers: () => Promise<void>;
  acceptOffer: (offerId: string) => Promise<CommandOutcome<DispatchAssignment>>;
  rejectOffer: (offerId: string) => Promise<CommandOutcome<DispatchAssignment>>;
  confirmPickup: (jobId: string, proof?: DeliveryProof) => Promise<CommandOutcome<Partial<DeliveryJob>>>;
  confirmDelivery: (jobId: string, proof?: DeliveryProof) => Promise<CommandOutcome<Partial<DeliveryJob>>>;
  restoreActiveDelivery: () => Promise<void>;
  dismissError: () => void;
}

const DeliveryStoreContext = createContext<DeliveryStoreContextType | null>(null);

export const DeliveryStoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { session } = useAuth();
  const { isOnline } = useCaptainStore();
  const [activeDelivery, setActiveDelivery] = useState<DeliveryJob | null>(null);
  const [pendingOffers, setPendingOffers] = useState<DispatchOffer[]>([]);
  const [activeOffer, setActiveOffer] = useState<DispatchOffer | null>(null);
  const [isRespondingOffer, setIsRespondingOffer] = useState(false);
  const [isConfirmingPickup, setIsConfirmingPickup] = useState(false);
  const [isConfirmingDelivery, setIsConfirmingDelivery] = useState(false);
  const [deliveryError, setDeliveryError] = useState<AppError | null>(null);
  const [lastCommandOutcome, setLastCommandOutcome] = useState<CommandOutcome<any> | null>(null);

  const refreshOffers = useCallback(async () => {
    if (!isOnline) {
      setPendingOffers([]);
      setActiveOffer(null);
      return;
    }

    const result = await dispatchRepository.getPendingOffers();
    if (result.success) {
      setPendingOffers(result.data);
      if (result.data.length > 0 && !activeDelivery) {
        setActiveOffer(result.data[0]);
      } else {
        setActiveOffer(null);
      }
    }
  }, [isOnline, activeDelivery]);

  const restoreActiveDelivery = useCallback(async () => {
    if (!session) {
      setActiveDelivery(null);
      return;
    }

    const result = await deliveryRepository.getActiveDelivery();
    if (result.success) {
      const serverJob = result.data;
      if (serverJob) {
        setActiveDelivery((current) => {
          if (!current) return serverJob;
          // Protect monotonic progression against stale out-of-order responses
          if (isDeliveryStateMoreAdvanced(current.state, serverJob.state)) {
            return current;
          }
          return serverJob;
        });
      }
    }
    // Also trigger background reconciliation for any pending/unknown mutations
    await reconciliationService.reconcile();
  }, [session]);

  // Subscribe to reconciliation events
  useEffect(() => {
    const unsubscribe = reconciliationService.subscribe((updatedJob) => {
      if (updatedJob !== undefined) {
        setActiveDelivery((current) => {
          if (!updatedJob) return null;
          if (!current) return updatedJob as DeliveryJob;
          if (updatedJob.state && isDeliveryStateMoreAdvanced(current.state, updatedJob.state)) {
            return current;
          }
          return { ...current, ...updatedJob } as DeliveryJob;
        });
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (mounted) {
        await restoreActiveDelivery();
      }
    })();
    return () => {
      mounted = false;
    };
  }, [restoreActiveDelivery]);

  useEffect(() => {
    locationUploader.setActiveDelivery(!!activeDelivery);
  }, [activeDelivery]);

  const acceptOffer = useCallback(async (offerId: string): Promise<CommandOutcome<DispatchAssignment>> => {
    setIsRespondingOffer(true);
    setDeliveryError(null);

    const outcome = await dispatchRepository.respondToOffer(offerId, 'ACCEPT');
    setLastCommandOutcome(outcome);
    setIsRespondingOffer(false);

    if (outcome.outcome === 'ACKNOWLEDGED') {
      const assignment = outcome.data;
      const newJob: DeliveryJob = {
        jobId: assignment.jobId,
        orderId: assignment.orderId,
        outletId: assignment.outletId,
        outletName: assignment.outletName,
        originLatitude: assignment.originLatitude,
        originLongitude: assignment.originLongitude,
        deliveryAddress: assignment.deliveryAddress,
        state: 'ASSIGNED',
        earningPaise: activeOffer?.estimatedEarningPaise,
        itemCount: activeOffer?.itemCount,
        assignedAt: new Date().toISOString(),
      };

      setActiveDelivery(newJob);
      setActiveOffer(null);
      setPendingOffers((prev) => prev.filter((o) => o.offerId !== offerId));
    } else if (outcome.outcome === 'REJECTED') {
      setDeliveryError(outcome.error);
      setPendingOffers((prev) => prev.filter((o) => o.offerId !== offerId));
      setActiveOffer(null);
    } else {
      // UNKNOWN: Network lost while accepting
      if ('error' in outcome && outcome.error) {
        setDeliveryError(outcome.error);
      }
    }

    return outcome;
  }, [activeOffer]);

  const rejectOffer = useCallback(async (offerId: string): Promise<CommandOutcome<DispatchAssignment>> => {
    setIsRespondingOffer(true);
    setDeliveryError(null);

    const outcome = await dispatchRepository.respondToOffer(offerId, 'REJECT');
    setLastCommandOutcome(outcome);
    setIsRespondingOffer(false);

    setPendingOffers((prev) => prev.filter((o) => o.offerId !== offerId));
    if (activeOffer?.offerId === offerId) {
      setActiveOffer(null);
    }

    return outcome;
  }, [activeOffer]);

  const confirmPickup = useCallback(async (
    jobId: string,
    proof?: DeliveryProof,
  ): Promise<CommandOutcome<Partial<DeliveryJob>>> => {
    setIsConfirmingPickup(true);
    setDeliveryError(null);

    // Transition to intermediate state: PICKUP_CONFIRMING
    setActiveDelivery((prev) => (prev ? { ...prev, state: 'PICKUP_CONFIRMING' } : null));

    const outcome = await deliveryRepository.markPickedUp(jobId, proof);
    setLastCommandOutcome(outcome);
    setIsConfirmingPickup(false);

    if (outcome.outcome === 'ACKNOWLEDGED') {
      setActiveDelivery((prev) => (prev ? {
        ...prev,
        state: 'PICKED_UP',
        pickedUpAt: outcome.data.pickedUpAt || new Date().toISOString(),
        pickupProof: proof,
      } : null));
    } else if (outcome.outcome === 'UNKNOWN') {
      setActiveDelivery((prev) => (prev ? {
        ...prev,
        state: 'UNKNOWN',
      } : null));
      setDeliveryError(outcome.error);
    } else if (outcome.outcome === 'PENDING') {
      setActiveDelivery((prev) => (prev ? {
        ...prev,
        state: 'UNKNOWN',
      } : null));
      if (outcome.error) setDeliveryError(outcome.error);
    } else if (outcome.outcome === 'REJECTED') {
      // Revert to ASSIGNED
      setActiveDelivery((prev) => (prev ? {
        ...prev,
        state: 'ASSIGNED',
      } : null));
      setDeliveryError(outcome.error);
    }

    return outcome;
  }, []);

  const confirmDelivery = useCallback(async (
    jobId: string,
    proof?: DeliveryProof,
  ): Promise<CommandOutcome<Partial<DeliveryJob>>> => {
    setIsConfirmingDelivery(true);
    setDeliveryError(null);

    // Transition to intermediate state: DELIVERY_CONFIRMING
    setActiveDelivery((prev) => (prev ? { ...prev, state: 'DELIVERY_CONFIRMING' } : null));

    const outcome = await deliveryRepository.markDelivered(jobId, proof);
    setLastCommandOutcome(outcome);
    setIsConfirmingDelivery(false);

    if (outcome.outcome === 'ACKNOWLEDGED') {
      setActiveDelivery((prev) => (prev ? {
        ...prev,
        state: 'DELIVERED',
        deliveredAt: outcome.data.deliveredAt || new Date().toISOString(),
        deliveryProof: proof,
      } : null));
    } else if (outcome.outcome === 'UNKNOWN') {
      setActiveDelivery((prev) => (prev ? {
        ...prev,
        state: 'UNKNOWN',
      } : null));
      setDeliveryError(outcome.error);
    } else if (outcome.outcome === 'PENDING') {
      setActiveDelivery((prev) => (prev ? {
        ...prev,
        state: 'UNKNOWN',
      } : null));
      if (outcome.error) setDeliveryError(outcome.error);
    } else if (outcome.outcome === 'REJECTED') {
      // Revert to PICKED_UP
      setActiveDelivery((prev) => (prev ? {
        ...prev,
        state: 'PICKED_UP',
      } : null));
      setDeliveryError(outcome.error);
    }

    return outcome;
  }, []);

  const dismissError = useCallback(() => {
    setDeliveryError(null);
  }, []);

  const value = useMemo<DeliveryStoreContextType>(() => ({
    activeDelivery,
    pendingOffers,
    activeOffer,
    deliveryState: activeDelivery?.state ?? null,
    isRespondingOffer,
    isConfirmingPickup,
    isConfirmingDelivery,
    deliveryError,
    lastCommandOutcome,
    refreshOffers,
    acceptOffer,
    rejectOffer,
    confirmPickup,
    confirmDelivery,
    restoreActiveDelivery,
    dismissError,
  }), [
    activeDelivery,
    pendingOffers,
    activeOffer,
    isRespondingOffer,
    isConfirmingPickup,
    isConfirmingDelivery,
    deliveryError,
    lastCommandOutcome,
    refreshOffers,
    acceptOffer,
    rejectOffer,
    confirmPickup,
    confirmDelivery,
    restoreActiveDelivery,
    dismissError,
  ]);

  return (
    <DeliveryStoreContext.Provider value={value}>
      {children}
    </DeliveryStoreContext.Provider>
  );
};

export function useDeliveryStore(): DeliveryStoreContextType {
  const context = useContext(DeliveryStoreContext);
  if (!context) {
    throw new Error('useDeliveryStore must be used within DeliveryStoreProvider');
  }
  return context;
}
