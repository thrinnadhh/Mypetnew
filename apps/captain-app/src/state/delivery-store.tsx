import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import { useAuth } from '../auth/context';
import { getAuthGeneration, getRuntimeAccountId } from '../auth/session';
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
  refreshOffers: () => Promise<DispatchOffer[]>;
  revalidateOffer: (offerId: string) => Promise<boolean | null>;
  acceptOffer: (offerId: string) => Promise<CommandOutcome<DispatchAssignment>>;
  rejectOffer: (offerId: string) => Promise<CommandOutcome<DispatchAssignment>>;
  confirmPickup: (jobId: string, proof?: DeliveryProof) => Promise<CommandOutcome<Partial<DeliveryJob>>>;
  confirmDelivery: (jobId: string, proof?: DeliveryProof) => Promise<CommandOutcome<Partial<DeliveryJob>>>;
  restoreActiveDelivery: () => Promise<DeliveryJob | null>;
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
  const offersRequestSequence = useRef(0);
  const restoreRequestSequence = useRef(0);
  const offerMutationPending = useRef(false);
  const pickupMutationPending = useRef(false);
  const deliveryMutationPending = useRef(false);

  const captureSession = useCallback(() => ({
    accountId: getRuntimeAccountId(),
    generation: getAuthGeneration(),
  }), []);

  const sessionIsCurrent = useCallback((captured: ReturnType<typeof captureSession>) =>
    !!captured.accountId &&
    getRuntimeAccountId() === captured.accountId &&
    getAuthGeneration() === captured.generation, [captureSession]);

  const applyAuthoritativeOffers = useCallback((offers: DispatchOffer[]) => {
    setPendingOffers(offers);
    if (offers.length > 0 && !activeDelivery) {
      setActiveOffer(offers[0]);
    } else {
      setActiveOffer(null);
    }
  }, [activeDelivery]);

  const refreshOffers = useCallback(async (): Promise<DispatchOffer[]> => {
    const requestSequence = ++offersRequestSequence.current;
    const capturedSession = captureSession();
    if (!isOnline) {
      setPendingOffers([]);
      setActiveOffer(null);
      return [];
    }

    const result = await dispatchRepository.getPendingOffers();
    if (
      result.success &&
      requestSequence === offersRequestSequence.current &&
      sessionIsCurrent(capturedSession)
    ) {
      applyAuthoritativeOffers(result.data);
      return result.data;
    }
    return [];
  }, [isOnline, captureSession, sessionIsCurrent, applyAuthoritativeOffers]);

  const revalidateOffer = useCallback(async (offerId: string): Promise<boolean | null> => {
    const requestSequence = ++offersRequestSequence.current;
    const capturedSession = captureSession();
    const result = await dispatchRepository.getPendingOffers();
    if (
      requestSequence !== offersRequestSequence.current ||
      !sessionIsCurrent(capturedSession)
    ) {
      return null;
    }
    if (!result.success) return null;
    applyAuthoritativeOffers(result.data);
    return result.data.some((offer) => offer.offerId === offerId);
  }, [captureSession, sessionIsCurrent, applyAuthoritativeOffers]);

  const restoreActiveDelivery = useCallback(async (): Promise<DeliveryJob | null> => {
    const requestSequence = ++restoreRequestSequence.current;
    const capturedSession = captureSession();
    if (!session) {
      setActiveDelivery(null);
      return null;
    }

    const result = await deliveryRepository.getActiveDelivery();
    if (
      requestSequence !== restoreRequestSequence.current ||
      !sessionIsCurrent(capturedSession)
    ) {
      return null;
    }

    let serverJob: DeliveryJob | null = null;
    if (result.success) {
      serverJob = result.data;
      // Explicit reconciliation is server-authoritative, including clearing a stale local job.
      setActiveDelivery(serverJob);
    }
    // Also trigger background reconciliation for any pending/unknown mutations
    await reconciliationService.reconcile();
    return sessionIsCurrent(capturedSession) ? serverJob : null;
  }, [session, captureSession, sessionIsCurrent]);

  // Subscribe to reconciliation events
  useEffect(() => {
    const capturedSession = captureSession();
    const unsubscribe = reconciliationService.subscribe((updatedJob) => {
      if (updatedJob !== undefined && sessionIsCurrent(capturedSession)) {
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
  }, [session?.accountId, captureSession, sessionIsCurrent]);

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
    const isTrackableDelivery =
      !!activeDelivery && activeDelivery.state !== 'DELIVERED' && activeDelivery.state !== 'FAILED';
    locationUploader.setActiveDelivery(isTrackableDelivery);
  }, [activeDelivery]);

  const acceptOffer = useCallback(async (offerId: string): Promise<CommandOutcome<DispatchAssignment>> => {
    if (activeDelivery && activeDelivery.state !== 'DELIVERED' && activeDelivery.state !== 'FAILED') {
      throw AppError.fromHttp(409, {
        code: 'ACTIVE_DELIVERY_EXISTS',
        message: 'Complete or reconcile the active delivery before accepting another assignment',
      });
    }
    if (offerMutationPending.current) {
      throw AppError.fromHttp(409, {
        code: 'OFFER_RESPONSE_IN_PROGRESS',
        message: 'An assignment response is already in progress',
      });
    }
    offerMutationPending.current = true;
    const capturedSession = captureSession();
    setIsRespondingOffer(true);
    setDeliveryError(null);

    const outcome = await dispatchRepository.respondToOffer(offerId, 'ACCEPT').finally(() => {
      offerMutationPending.current = false;
      if (sessionIsCurrent(capturedSession)) setIsRespondingOffer(false);
    });
    if (!sessionIsCurrent(capturedSession)) return outcome;
    setLastCommandOutcome(outcome);

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
  }, [activeDelivery, activeOffer, captureSession, sessionIsCurrent]);

  const rejectOffer = useCallback(async (offerId: string): Promise<CommandOutcome<DispatchAssignment>> => {
    if (offerMutationPending.current) {
      throw AppError.fromHttp(409, {
        code: 'OFFER_RESPONSE_IN_PROGRESS',
        message: 'An assignment response is already in progress',
      });
    }
    offerMutationPending.current = true;
    const capturedSession = captureSession();
    setIsRespondingOffer(true);
    setDeliveryError(null);

    const outcome = await dispatchRepository.respondToOffer(offerId, 'REJECT').finally(() => {
      offerMutationPending.current = false;
      if (sessionIsCurrent(capturedSession)) setIsRespondingOffer(false);
    });
    if (!sessionIsCurrent(capturedSession)) return outcome;
    setLastCommandOutcome(outcome);

    setPendingOffers((prev) => prev.filter((o) => o.offerId !== offerId));
    if (activeOffer?.offerId === offerId) {
      setActiveOffer(null);
    }

    return outcome;
  }, [activeOffer, captureSession, sessionIsCurrent]);

  const confirmPickup = useCallback(async (
    jobId: string,
    proof?: DeliveryProof,
  ): Promise<CommandOutcome<Partial<DeliveryJob>>> => {
    if (!activeDelivery || activeDelivery.jobId !== jobId) {
      throw AppError.fromHttp(403, {
        code: 'DELIVERY_JOB_SESSION_MISMATCH',
        message: 'This delivery is not the active assignment for the current session',
      });
    }
    if (!['ASSIGNED', 'ARRIVING_PICKUP', 'PICKUP_CONFIRMING'].includes(activeDelivery.state)) {
      throw AppError.fromHttp(409, {
        code: 'INVALID_PICKUP_TRANSITION',
        message: 'Pickup cannot be confirmed from the current delivery state',
      });
    }
    if (pickupMutationPending.current) {
      throw AppError.fromHttp(409, {
        code: 'PICKUP_CONFIRMATION_IN_PROGRESS',
        message: 'Pickup confirmation is already in progress',
      });
    }
    pickupMutationPending.current = true;
    const capturedSession = captureSession();
    setIsConfirmingPickup(true);
    setDeliveryError(null);

    // Transition to intermediate state: PICKUP_CONFIRMING
    setActiveDelivery((prev) => (prev ? { ...prev, state: 'PICKUP_CONFIRMING' } : null));

    const outcome = await deliveryRepository.markPickedUp(jobId, proof).finally(() => {
      pickupMutationPending.current = false;
      if (sessionIsCurrent(capturedSession)) setIsConfirmingPickup(false);
    });
    if (!sessionIsCurrent(capturedSession)) return outcome;
    setLastCommandOutcome(outcome);

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
  }, [activeDelivery, captureSession, sessionIsCurrent]);

  const confirmDelivery = useCallback(async (
    jobId: string,
    proof?: DeliveryProof,
  ): Promise<CommandOutcome<Partial<DeliveryJob>>> => {
    if (!activeDelivery || activeDelivery.jobId !== jobId) {
      throw AppError.fromHttp(403, {
        code: 'DELIVERY_JOB_SESSION_MISMATCH',
        message: 'This delivery is not the active assignment for the current session',
      });
    }
    if (!['PICKED_UP', 'ARRIVING_CUSTOMER', 'DELIVERY_CONFIRMING'].includes(activeDelivery.state)) {
      throw AppError.fromHttp(409, {
        code: 'INVALID_DELIVERY_TRANSITION',
        message: 'Delivery cannot be completed before pickup is confirmed',
      });
    }
    if (deliveryMutationPending.current) {
      throw AppError.fromHttp(409, {
        code: 'DELIVERY_CONFIRMATION_IN_PROGRESS',
        message: 'Delivery confirmation is already in progress',
      });
    }
    deliveryMutationPending.current = true;
    const capturedSession = captureSession();
    setIsConfirmingDelivery(true);
    setDeliveryError(null);

    // Transition to intermediate state: DELIVERY_CONFIRMING
    setActiveDelivery((prev) => (prev ? { ...prev, state: 'DELIVERY_CONFIRMING' } : null));

    const outcome = await deliveryRepository.markDelivered(jobId, proof).finally(() => {
      deliveryMutationPending.current = false;
      if (sessionIsCurrent(capturedSession)) setIsConfirmingDelivery(false);
    });
    if (!sessionIsCurrent(capturedSession)) return outcome;
    setLastCommandOutcome(outcome);

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
  }, [activeDelivery, captureSession, sessionIsCurrent]);

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
    revalidateOffer,
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
    revalidateOffer,
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
