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
type AccountSnapshot = { accountId: string; accessToken: string; authEpoch: number };

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
  const actionInFlightRef = useRef(false);
  const accountRef = useRef<{ accountId: string | null; accessToken: string | null; authEpoch: number }>({ accountId: null, accessToken: null, authEpoch: apiClient.getAuthEpoch() });

  accountRef.current = { accountId, accessToken, authEpoch: apiClient.getAuthEpoch() };

  const captureAccount = useCallback((): AccountSnapshot | null => {
    const current = accountRef.current;
    if (!current.accountId || !current.accessToken) return null;
    return { accountId: current.accountId, accessToken: current.accessToken, authEpoch: current.authEpoch };
  }, []);

  const accountStillCurrent = useCallback((captured: AccountSnapshot) => {
    const current = accountRef.current;
    return current.accountId === captured.accountId
      && current.accessToken === captured.accessToken
      && current.authEpoch === captured.authEpoch
      && apiClient.getAuthEpoch() === captured.authEpoch;
  }, []);

  const load = useCallback(async () => {
    const captured = captureAccount();
    if (!captured) return;
    const generation = ++loadGenerationRef.current;
    setLoadingMore(false);
    setState('loading');
    setLoadMoreError(null);
    try {
      const page = await fetchCustomerOrderPage(captured.accessToken, 0, PAGE_SIZE, activeTab);
      if (generation !== loadGenerationRef.current || !accountStillCurrent(captured)) return;
      setOrders(page.items);
      setNextPage(1);
      setNextCursor(page.nextCursor);
      setHasNext(page.hasNext);
      setState('ready');
    } catch (error) {
      if (generation !== loadGenerationRef.current || !accountStillCurrent(captured)) return;
      setOrders([]);
      setHasNext(false);
      setNextCursor(null);
      setState(isOfflineError(error) ? 'offline' : 'error');
    }
  }, [accountStillCurrent, activeTab, captureAccount]);

  const loadMore = useCallback(async () => {
    const captured = captureAccount();
    if (!captured || !hasNext || !nextCursor || loadingMore) return;
    const generation = loadGenerationRef.current;
    const cursorAtStart = nextCursor;
    const pageAtStart = nextPage;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const page = await fetchCustomerOrderPage(captured.accessToken, pageAtStart, PAGE_SIZE, activeTab, cursorAtStart);
      if (generation !== loadGenerationRef.current || !accountStillCurrent(captured)) return;
      setOrders((current) => [
        ...current,
        ...page.items.filter((item) => !current.some((existing) => existing.id === item.id)),
      ]);
      setNextPage(pageAtStart + 1);
      setNextCursor(page.nextCursor);
      setHasNext(page.hasNext);
    } catch (error) {
      if (generation !== loadGenerationRef.current || !accountStillCurrent(captured)) return;
      setLoadMoreError(isOfflineError(error) ? 'offline' : 'error');
    } finally {
      if (generation === loadGenerationRef.current && accountStillCurrent(captured)) setLoadingMore(false);
    }
  }, [accountStillCurrent, activeTab, captureAccount, hasNext, loadingMore, nextCursor, nextPage]);

  useEffect(() => {
    loadGenerationRef.current += 1;
    actionInFlightRef.current = false;
    setActionLoading(false);
    if (!accountId || !accessToken || !user) {
      setOrders([]);
      setState('idle');
      setHasNext(false);
      setNextCursor(null);
      setNextPage(1);
      setLoadingMore(false);
      setLoadMoreError(null);
      return;
    }
    setOrders([]);
    void load();
    return () => { loadGenerationRef.current += 1; };
  }, [accessToken, accountId, load, user]);

  const cancel = useCallback(async (orderId: string, reason: string) => {
    const captured = captureAccount();
    if (!captured || actionInFlightRef.current) return;
    actionInFlightRef.current = true;
    setActionLoading(true);
    try {
      await cancelCustomerOrder(orderId, reason, captured.accessToken);
      if (!accountStillCurrent(captured)) return;
      await load();
    } finally {
      actionInFlightRef.current = false;
      if (accountStillCurrent(captured)) setActionLoading(false);
    }
  }, [accountStillCurrent, captureAccount, load]);

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