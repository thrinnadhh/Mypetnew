import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { apiClient } from '@/services/api-client';
import {
  cancelAppointment,
  fetchCustomerAppointments,
  rescheduleAppointment,
  submitAppointmentReview,
  type AppointmentTabCategory,
  type CustomerAppointmentRecord,
} from '@/services/customer-history';
import { isOfflineError } from '@/services/customer-profile';

export type AppointmentsStateKind = 'idle' | 'loading' | 'ready' | 'error' | 'offline';

const PROVIDER_DECISION_REFRESH_MS = 15_000;

type AccountSnapshot = { userId: string; accessToken: string; authEpoch: number };

export function useAppointments() {
  const { user, session } = useAuth();
  const userId = user?.id ?? null;
  const accessToken = session?.accessToken ?? null;
  const [appointments, setAppointments] = useState<CustomerAppointmentRecord[]>([]);
  const [state, setState] = useState<AppointmentsStateKind>('idle');
  const [activeTab, setActiveTab] = useState<AppointmentTabCategory>('upcoming');
  const [searchQuery, setSearchQuery] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const loadGenerationRef = useRef(0);
  const actionInFlightRef = useRef(false);

  const captureAccount = useCallback((): AccountSnapshot | null => {
    if (!userId || !accessToken) return null;
    return { userId, accessToken, authEpoch: apiClient.getAuthEpoch() };
  }, [accessToken, userId]);

  const accountStillCurrent = useCallback((captured: AccountSnapshot) => (
    userId === captured.userId
    && accessToken === captured.accessToken
    && apiClient.getAuthEpoch() === captured.authEpoch
  ), [accessToken, userId]);

  const load = useCallback(async () => {
    const captured = captureAccount();
    const generation = ++loadGenerationRef.current;
    if (!captured) {
      setAppointments([]);
      setState('idle');
      return;
    }
    setState('loading');
    try {
      const data = await fetchCustomerAppointments(captured.userId, captured.accessToken);
      if (!accountStillCurrent(captured) || loadGenerationRef.current !== generation) return;
      setAppointments(data);
      setState('ready');
    } catch (error) {
      if (!accountStillCurrent(captured) || loadGenerationRef.current !== generation) return;
      setState(isOfflineError(error) ? 'offline' : 'error');
    }
  }, [accountStillCurrent, captureAccount]);

  const refreshProviderDecision = useCallback(async () => {
    const captured = captureAccount();
    if (!captured) return;
    const generation = loadGenerationRef.current;
    try {
      const data = await fetchCustomerAppointments(captured.userId, captured.accessToken);
      if (!accountStillCurrent(captured) || loadGenerationRef.current !== generation) return;
      setAppointments(data);
      setState('ready');
    } catch (error) {
      // Keep the last server-authoritative projection during transient background failures.
      if (!accountStillCurrent(captured) || isOfflineError(error)) return;
    }
  }, [accountStillCurrent, captureAccount]);

  useEffect(() => {
    loadGenerationRef.current += 1;
    actionInFlightRef.current = false;
    setActionLoading(false);
    setAppointments([]);
    setState(userId && accessToken ? 'loading' : 'idle');
    if (userId && accessToken) void load();
    return () => { loadGenerationRef.current += 1; };
  }, [accessToken, load, userId]);

  const hasPendingProviderDecision = appointments.some((appointment) => appointment.status === 'PENDING_PROVIDER');

  useEffect(() => {
    if (!hasPendingProviderDecision || !userId || !accessToken) return undefined;
    const timer = setInterval(() => {
      void refreshProviderDecision();
    }, PROVIDER_DECISION_REFRESH_MS);
    return () => clearInterval(timer);
  }, [accessToken, hasPendingProviderDecision, refreshProviderDecision, userId]);

  const filteredAppointments = useMemo(() => {
    return appointments.filter((appt) => {
      const isClosed = appt.status === 'CANCELLED' || appt.status === 'EXPIRED' || appt.status === 'REJECTED';
      const isPast = appt.status === 'COMPLETED' || appt.status === 'NO_SHOW';

      if (activeTab === 'cancelled' && !isClosed) return false;
      if (activeTab === 'past' && (!isPast || isClosed)) return false;
      if (activeTab === 'upcoming' && (isPast || isClosed)) return false;

      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchProvider = appt.providerName.toLowerCase().includes(query);
        const matchService = appt.serviceName.toLowerCase().includes(query);
        const matchPet = appt.petName.toLowerCase().includes(query);
        if (!matchProvider && !matchService && !matchPet) return false;
      }

      return true;
    });
  }, [activeTab, appointments, searchQuery]);

  const runAction = useCallback(async <T,>(operation: (captured: AccountSnapshot) => Promise<T>): Promise<T | null> => {
    const captured = captureAccount();
    if (!captured || actionInFlightRef.current) return null;
    actionInFlightRef.current = true;
    setActionLoading(true);
    try {
      const result = await operation(captured);
      if (!accountStillCurrent(captured)) return null;
      await load();
      if (!accountStillCurrent(captured)) return null;
      return result;
    } finally {
      actionInFlightRef.current = false;
      if (accountStillCurrent(captured)) setActionLoading(false);
    }
  }, [accountStillCurrent, captureAccount, load]);

  const cancel = useCallback(
    async (appointmentId: string, reason: string) => {
      await runAction((captured) => cancelAppointment(appointmentId, reason, captured.accessToken));
    },
    [runAction],
  );

  const reschedule = useCallback(
    async (appointmentId: string, newSlotId: string) => {
      await runAction((captured) => rescheduleAppointment(appointmentId, newSlotId, captured.accessToken));
    },
    [runAction],
  );

  const submitReview = useCallback(
    async (input: { providerId: string; targetId: string; rating: number; comment: string }) => {
      const result = await runAction((captured) => submitAppointmentReview({
        customerId: captured.userId,
        providerId: input.providerId,
        targetId: input.targetId,
        rating: input.rating,
        comment: input.comment,
        accessToken: captured.accessToken,
      }));
      return result ?? 'error';
    },
    [runAction],
  );

  return {
    user,
    session,
    appointments,
    filteredAppointments,
    state,
    activeTab,
    setActiveTab,
    searchQuery,
    setSearchQuery,
    actionLoading,
    reload: load,
    cancel,
    reschedule,
    submitReview,
  };
}
