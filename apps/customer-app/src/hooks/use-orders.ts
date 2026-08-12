import { useCallback, useEffect, useMemo, useState } from 'react';

import { useAuth } from '@/context/AuthContext';
import { useCart } from '@/context/CartContext';
import {
  cancelOrder,
  fetchCustomerOrders,
  reorderItems,
  type CustomerOrderRecord,
  type OrderTabCategory,
  type ReorderValidationResult,
} from '@/services/customer-orders';
import { isOfflineError } from '@/services/customer-profile';
import { buildCartFromRevalidation } from '@/services/revalidated-cart';

export type OrdersStateKind = 'idle' | 'loading' | 'ready' | 'error' | 'offline';

export function useOrders() {
  const { user, session } = useAuth();
  const { replaceCart } = useCart();
  const [orders, setOrders] = useState<CustomerOrderRecord[]>([]);
  const [state, setState] = useState<OrdersStateKind>('idle');
  const [activeTab, setActiveTab] = useState<OrderTabCategory>('active');
  const [searchQuery, setSearchQuery] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const load = useCallback(async () => {
    if (!user || !session) return;
    setState('loading');
    try {
      const data = await fetchCustomerOrders(user.id, session.access_token);
      setOrders(data);
      setState('ready');
    } catch (error) {
      setState(isOfflineError(error) ? 'offline' : 'error');
    }
  }, [session, user]);

  useEffect(() => {
    if (user && session) void load();
  }, [load, session, user]);

  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      const isPast = ['DELIVERED', 'COMPLETED', 'CANCELLED', 'REJECTED'].includes(order.status);
      const isSub = Boolean(order.isSubscription);

      if (activeTab === 'subscription' && !isSub) return false;
      if (activeTab === 'past' && !isPast) return false;
      if (activeTab === 'active' && (isPast || isSub)) return false;

      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchProvider = order.providerName.toLowerCase().includes(query);
        const matchItem = order.items.some((item) => item.toLowerCase().includes(query));
        const matchId = order.id.toLowerCase().includes(query);
        if (!matchProvider && !matchItem && !matchId) return false;
      }

      return true;
    });
  }, [activeTab, orders, searchQuery]);

  const cancel = useCallback(
    async (orderId: string, reason: string) => {
      if (!session) return;
      setActionLoading(true);
      try {
        await cancelOrder(orderId, reason, session.access_token);
        await load();
      } finally {
        setActionLoading(false);
      }
    },
    [load, session],
  );

  const reorder = useCallback(
    async (orderId: string): Promise<ReorderValidationResult | null> => {
      if (!session) return null;
      setActionLoading(true);
      try {
        const result = await reorderItems(orderId, session.access_token);
        if (result.canReorder) {
          const nextItems = await buildCartFromRevalidation(result);
          await replaceCart(nextItems);
        }
        return result;
      } finally {
        setActionLoading(false);
      }
    },
    [replaceCart, session],
  );

  return {
    user,
    session,
    orders,
    filteredOrders,
    state,
    activeTab,
    setActiveTab,
    searchQuery,
    setSearchQuery,
    actionLoading,
    reload: load,
    cancel,
    reorder,
  };
}
