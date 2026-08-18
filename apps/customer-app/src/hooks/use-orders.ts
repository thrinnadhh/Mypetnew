import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/context/AuthContext';
import { apiClient } from '@/services/api-client';
import { cancelCustomerOrder } from '@/services/customer-order-detail';
import {
  fetchCustomerOrderPage,
  type CustomerOrderCursor,
  type CustomerOrderSummaryRecord,
  type OrderTabCategory,
} from '@/services/customer-order-list';
import { isOfflineError } from '@/services/customer-profile';

export type OrdersStateKind = 'idle' | 'loading' | 'ready' | 'error' | 'offline';

const PAGE_SIZE = 20;

export function useOrders() {
  const { user, session } = useAuth();
  const accountId = session?.accountId ?? null;
  const accessToken = session?.accessToken ?? null;
  const [orders, setOrders] = useState<CustomerOrderSummaryRecord[]>([]);
  const [state, setState] = useState<OrdersStateKind>('idle');
  const [activeTab, setActiveTab] = useState<OrderTabCategory>('active');
  const [actionLoading, setActionLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<'offline' | 'error' | null>(null);
  const [nextPage, setNextPage] = useState(1);
  const [nextCursor, setNextCursor] = useState<CustomerOrderCursor | null>(null);
  const [hasNext, setHasNext] = useState(false);
  const loadGenerationRef = useRef(0);

  const load = useCallback(async () => {
    if (!accountId || !accessToken) return;
    const generation = ++loadGenerationRef.current;
    const authEpoch = apiClient.getAuthEpoch();
    setLoadingMore(false);
    setState('loading');
    setLoadMoreError(null);
    try {
      const page = await fetchCustomerOrderPage(accessToken, 0, PAGE_SIZE, activeTab);
      if (generation !== loadGenerationRef.current || authEpoch !== apiClient.getAuthEpoch()) return;
      setOrders(page.items);
      setNextPage(1);
      setNextCursor(page.nextCursor);
      setHasNext(page.hasNext);
      setState('ready');
    } catch (error) {
      if (generation !== loadGenerationRef.current || authEpoch !== apiClient.getAuthEpoch()) return;
      setOrders([]);
      setHasNext(false);
      setNextCursor(null);
      setState(isOfflineError(error) ? 'offline' : 'error');
    }
  }, [accessToken, accountId, activeTab]);

  const loadMore = useCallback(async () => {
    if (!accountId || !accessToken || !hasNext || !nextCursor || loadingMore) return;
    const generation = loadGenerationRef.current;
    const authEpoch = apiClient.getAuthEpoch();
    const cursorAtStart = nextCursor;
    const pageAtStart = nextPage;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const page = await fetchCustomerOrderPage(accessToken, pageAtStart, PAGE_SIZE, activeTab, cursorAtStart);
      if (generation !== loadGenerationRef.current || authEpoch !== apiClient.getAuthEpoch()) return;
      setOrders((current) => [
        ...current,
        ...page.items.filter((item) => !current.some((existing) => existing.id === item.id)),
      ]);
      setNextPage(pageAtStart + 1);
      setNextCursor(page.nextCursor);
      setHasNext(page.hasNext);
    } catch (error) {
      if (generation !== loadGenerationRef.current || authEpoch !== apiClient.getAuthEpoch()) return;
      setLoadMoreError(isOfflineError(error) ? 'offline' : 'error');
    } finally {
      if (generation === loadGenerationRef.current && authEpoch === apiClient.getAuthEpoch()) {
        setLoadingMore(false);
      }
    }
  }, [accessToken, accountId, activeTab, hasNext, loadingMore, nextCursor, nextPage]);

  useEffect(() => {
    if (!accountId || !accessToken || !user) {
      loadGenerationRef.current += 1;
      setOrders([]);
      setState('idle');
      setHasNext(false);
      setNextCursor(null);
      setNextPage(1);
      setLoadingMore(false);
      setLoadMoreError(null);
      return;
    }
    void load();
  }, [accessToken, accountId, load, user]);

  const cancel = useCallback(
    async (orderId: string, reason: string) => {
      if (!accessToken) return;
      setActionLoading(true);
      try {
        await cancelCustomerOrder(orderId, reason, accessToken);
        await load();
      } finally {
        setActionLoading(false);
      }
    },
    [accessToken, load],
  );

  return {
    user,
    session,
    orders,
    state,
    activeTab,
    setActiveTab,
    actionLoading,
    loadingMore,
    loadMoreError,
    hasNext,
    reload: load,
    loadMore,
    cancel,
  };
}
