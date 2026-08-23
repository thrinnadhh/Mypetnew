import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { useAuth } from '../auth/context';
import { CommandOutcome } from '../domain/command';
import { DeliveryJob, DeliveryProof, DeliveryState } from '../domain/delivery';
import { DispatchAssignment, DispatchOffer } from '../domain/dispatch';
import { AppError } from '../domain/result';
import { deliveryRepository } from '../repositories/delivery-repository';
import { dispatchRepository } from '../repositories/dispatch-repository';
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
    } else {
      // Failed read does not crash UI, but preserves state
    }
  }, [isOnline, activeDelivery]);

  const restoreActiveDelivery = useCallback(async () => {
    if (!session) {
      setActiveDelivery(null);
      return;
    }

    const result = await deliveryRepository.getActiveDelivery();
    if (result.success && result.data) {
      setActiveDelivery(result.data);
    }
  }, [session]);

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
        originLatitude: 12.9716,
        originLongitude: 77.5946,
        deliveryAddress: assignment.deliveryAddress,
        state: 'ASSIGNED',
        earningPaise: activeOffer?.estimatedEarningPaise || 5000,
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
      setDeliveryError(outcome.error);
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
    } else {
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
    } else {
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
