import React from 'react';
import { DeliveryStoreProvider, useDeliveryStore } from '../../state/delivery-store';

export const DeliveryProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return <DeliveryStoreProvider>{children}</DeliveryStoreProvider>;
};

export const useDelivery = useDeliveryStore;
