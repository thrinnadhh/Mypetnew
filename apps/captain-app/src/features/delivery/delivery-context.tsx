import React, { createContext, useContext, useEffect, useState } from 'react';
import { fetchActiveDelivery } from '../../api/deliveries';
import {
  fetchPendingOffers,
  markJobDelivered as apiMarkDelivered,
  markJobPickedUp as apiMarkPickedUp,
  respondToOffer as apiRespondToOffer,
} from '../../api/dispatch';
import { useAuth } from '../../auth/context';
import { clearIdempotencyKey, getOrCreateIdempotencyKey } from '../../utils/idempotency';
import { CaptainActiveDelivery, CaptainDeliveryOffer } from './types';

interface DeliveryContextValue {
  activeDelivery: CaptainActiveDelivery | null;
  pendingOffers: CaptainDeliveryOffer[];
  currentOffer: CaptainDeliveryOffer | null;
  isLoading: boolean;
  fetchOffers: () => Promise<CaptainDeliveryOffer[]>;
  acceptOffer: (offerId: string) => Promise<CaptainActiveDelivery>;
  rejectOffer: (offerId: string) => Promise<void>;
  markPickedUp: () => Promise<void>;
  markDelivered: () => Promise<void>;
  clearCompletedDelivery: () => void;
  restoreActiveDelivery: () => Promise<CaptainActiveDelivery | null>;
  dismissOffer: (offerId: string) => void;
}

const DeliveryContext = createContext<DeliveryContextValue | null>(null);

export const DeliveryProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { session, captainProfile } = useAuth();
  const [activeDelivery, setActiveDelivery] = useState<CaptainActiveDelivery | null>(null);
  const [pendingOffers, setPendingOffers] = useState<CaptainDeliveryOffer[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const currentOffer = pendingOffers.length > 0 ? pendingOffers[0] : null;

  const restoreActiveDelivery = async (): Promise<CaptainActiveDelivery | null> => {
    if (!session) return null;
    try {
      const active = await fetchActiveDelivery();
      if (active && active.dispatchStatus !== 'DELIVERED') {
        setActiveDelivery(active);
        return active;
      }
      return null;
    } catch {
      return null;
    }
  };

  const fetchOffers = async (): Promise<CaptainDeliveryOffer[]> => {
    if (!session || !captainProfile?.online) {
      setPendingOffers([]);
      return [];
    }
    try {
      const offers = await fetchPendingOffers();
      const mapped: CaptainDeliveryOffer[] = offers.map((o) => ({
        offerId: o.offerId,
        jobId: o.jobId,
        expiresAt: o.expiresAt,
        pickup: {
          outletName: o.outletName || 'MyPet Partner Outlet',
          area: o.area || 'Nearby Store',
          distanceMeters: o.distanceMeters || 1200,
        },
        package: {
          itemCount: o.itemCount || 1,
        },
        estimatedEarningPaise: o.estimatedEarningPaise || 7500,
      }));
      setPendingOffers(mapped);
      return mapped;
    } catch {
      return [];
    }
  };

  const acceptOffer = async (offerId: string): Promise<CaptainActiveDelivery> => {
    setIsLoading(true);
    try {
      const assignment = await apiRespondToOffer(offerId, 'ACCEPT');
      const orderRef = assignment.orderId ? `#MP-${assignment.orderId.slice(0, 6).toUpperCase()}` : '#MP-ORDER';
      
      const newActive: CaptainActiveDelivery = {
        jobId: assignment.jobId || 'job-unknown',
        orderId: assignment.orderId || 'order-unknown',
        orderReference: orderRef,
        dispatchStatus: 'ASSIGNED',
        merchant: {
          outletId: assignment.outletId || 'outlet-unknown',
          name: assignment.outletName || 'MyPet Store',
          address: 'Store Pickup Counter',
        },
        customer: assignment.deliveryAddress
          ? {
              name: assignment.deliveryAddress.recipientName,
              maskedPhone: assignment.deliveryAddress.phoneNumber,
              address: `${assignment.deliveryAddress.line1}, ${assignment.deliveryAddress.city} - ${assignment.deliveryAddress.pincode}`,
            }
          : undefined,
        earningPaise: 7500,
        assignedAt: new Date().toISOString(),
      };

      setActiveDelivery(newActive);
      setPendingOffers((prev) => prev.filter((o) => o.offerId !== offerId));
      return newActive;
    } finally {
      setIsLoading(false);
    }
  };

  const rejectOffer = async (offerId: string): Promise<void> => {
    setIsLoading(true);
    try {
      await apiRespondToOffer(offerId, 'REJECT');
      setPendingOffers((prev) => prev.filter((o) => o.offerId !== offerId));
    } finally {
      setIsLoading(false);
    }
  };

  const dismissOffer = (offerId: string) => {
    setPendingOffers((prev) => prev.filter((o) => o.offerId !== offerId));
  };

  const markPickedUp = async (): Promise<void> => {
    if (!activeDelivery) return;
    setIsLoading(true);
    const commandKey = `dispatch:pickup:${activeDelivery.jobId}`;
    const idempotencyKey = getOrCreateIdempotencyKey(commandKey);

    try {
      const result = await apiMarkPickedUp(activeDelivery.jobId, idempotencyKey);
      clearIdempotencyKey(commandKey);
      setActiveDelivery({
        ...activeDelivery,
        dispatchStatus: 'PICKED_UP',
        pickedUpAt: result.pickedUpAt || new Date().toISOString(),
      });
    } finally {
      setIsLoading(false);
    }
  };

  const markDelivered = async (): Promise<void> => {
    if (!activeDelivery) return;
    setIsLoading(true);
    const commandKey = `dispatch:delivered:${activeDelivery.jobId}`;
    const idempotencyKey = getOrCreateIdempotencyKey(commandKey);

    try {
      const result = await apiMarkDelivered(activeDelivery.jobId, idempotencyKey);
      clearIdempotencyKey(commandKey);
      setActiveDelivery({
        ...activeDelivery,
        dispatchStatus: 'DELIVERED',
        deliveredAt: result.deliveredAt || new Date().toISOString(),
      });
    } finally {
      setIsLoading(false);
    }
  };

  const clearCompletedDelivery = () => {
    setActiveDelivery(null);
  };

  useEffect(() => {
    if (session) {
      restoreActiveDelivery();
    } else {
      setActiveDelivery(null);
      setPendingOffers([]);
    }
  }, [session]);

  return (
    <DeliveryContext.Provider
      value={{
        activeDelivery,
        pendingOffers,
        currentOffer,
        isLoading,
        fetchOffers,
        acceptOffer,
        rejectOffer,
        markPickedUp,
        markDelivered,
        clearCompletedDelivery,
        restoreActiveDelivery,
        dismissOffer,
      }}
    >
      {children}
    </DeliveryContext.Provider>
  );
};

export function useDelivery(): DeliveryContextValue {
  const context = useContext(DeliveryContext);
  if (!context) {
    throw new Error('useDelivery must be used within a DeliveryProvider');
  }
  return context;
}
