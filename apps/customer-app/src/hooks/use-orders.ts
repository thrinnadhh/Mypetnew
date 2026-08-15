import { useCallback, useEffect, useMemo, useState } from 'react';

import { useAuth } from '@/context/AuthContext';
import { useCart } from '@/context/CartContext';
import { cancelCustomerOrder } from '@/services/customer-order-detail';
import {
  fetchCustomerOrderPage,
  type CustomerOrderSummaryRecord,
  type OrderTabCategory,
} from '@/services/customer-order-list';
import {
  reorderItems,
  type ReorderValidationResult,
} from '@/services/customer-orders';
import { isOfflineError } from '@/services/customer-profile';
import { buildCartFromRevalidation } from '@/services/revalidated-cart';

export type OrdersStateKind = 'idle' | 'loading' | 'ready' | 'error' | 'offline';

const PAGE_SIZE = 20;

export function useOrders() {
  const { user, session } = useAuth();
  const { replaceCart } = useCart();
  const [orders, setOrders] = useState<CustomerOrderSummaryRecord[]>([]);
  const [state, setState] = useState<OrdersStateKind>('idle');
  const [activeTab, setActiveTab] = useState<OrderTabCategory>('active');
  const [searchQuery, setSearchQuery] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextPage, setNextPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);

  const load = useCallback(async () => {
    if (!user || !session) return;
    setState('loading');
    try {
      const page = await fetchCustomerOrderPage(session.accessToken, 0, PAGE_SIZE);
      setOrders(page.items);
      setNextPage(1);
      setHasNext(page.hasNext);
      setState('ready');
    } catch (error) {
      setState(isOfflineError(error) ? 'offline' : 'error');
    }
  }, [session, user]);

  const loadMore = useCallback(async () => {
    if (!user || !session || !hasNext || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchCustomerOrderPage(session.accessToken, nextPage, PAGE_SIZE);
      setOrders((current) => [...current, ...page.items.filter((item) => !current.some((existing) => existing.id === item.id))]);
      setNextPage((current) => current + 1);
      setHasNext(page.hasNext);
    } catch (error) {
      setState(isOfflineError(error) ? 'offline' : 'error');
    } finally {
      setLoadingMore(false);
    }
  }, [hasNext, loadingMore, nextPage, session, user]);

  useEffect(() => {
    if (user && session) void load();
  }, [load, session, user]);

  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      const isPast = ['DELIVERED', 'COMPLETED', 'CANCELLED', 'REJECTED'].includes(order.status);
      const isSub = order.isSubscription;

      if (activeTab === 'subscription' && !isSub) return false;
      if (activeTab === 'past' && !isPast) return false;
      if (activeTab === 'active' && (isPast || isSub)) return false;

      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchProvider = order.providerName.toLowerCase().includes(query);
        const matchId = order.id.toLowerCase().includes(query);
        if (!matchProvider && !matchId) return false;
      }

      return true;
    });
  }, [activeTab, orders, searchQuery]);

  const cancel = useCallback(
    async (orderId: string, reason: string) => {
      if (!session) return;
      setActionLoading(true);
      try {
        await cancelCustomerOrder(orderId, reason, session.accessToken);
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
        const result = await reorderItems(orderId, session.accessToken);
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
    loadingMore,
    hasNext,
    reload: load,
    loadMore,
    cancel,
    reorder,
  };
}
