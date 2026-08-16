import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
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

export function useAppointments() {
  const { user, session } = useAuth();
  const [appointments, setAppointments] = useState<CustomerAppointmentRecord[]>([]);
  const [state, setState] = useState<AppointmentsStateKind>('idle');
  const [activeTab, setActiveTab] = useState<AppointmentTabCategory>('upcoming');
  const [searchQuery, setSearchQuery] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const load = useCallback(async () => {
    if (!user || !session) return;
    setState('loading');
    try {
      const data = await fetchCustomerAppointments(user.id, session.accessToken);
      setAppointments(data);
      setState('ready');
    } catch (error) {
      setState(isOfflineError(error) ? 'offline' : 'error');
    }
  }, [session, user]);

  const refreshProviderDecision = useCallback(async () => {
    if (!user || !session) return;
    try {
      const data = await fetchCustomerAppointments(user.id, session.accessToken);
      setAppointments(data);
      setState('ready');
    } catch (error) {
      // Background provider-decision polling must never replace usable appointment
      // state with a transient error. The normal retry/reload path remains visible
      // if the user explicitly refreshes while offline or the API is unavailable.
      if (!isOfflineError(error)) return;
    }
  }, [session, user]);

  useEffect(() => {
    if (user && session) void load();
  }, [load, session, user]);

  const hasPendingProviderDecision = appointments.some((appointment) => appointment.status === 'PENDING_PROVIDER');

  useEffect(() => {
    if (!hasPendingProviderDecision || !user || !session) return undefined;
    const timer = setInterval(() => {
      void refreshProviderDecision();
    }, PROVIDER_DECISION_REFRESH_MS);
    return () => clearInterval(timer);
  }, [hasPendingProviderDecision, refreshProviderDecision, session, user]);

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

  const cancel = useCallback(
    async (appointmentId: string, reason: string) => {
      if (!session) return;
      setActionLoading(true);
      try {
        await cancelAppointment(appointmentId, reason, session.accessToken);
        await load();
      } finally {
        setActionLoading(false);
      }
    },
    [load, session],
  );

  const reschedule = useCallback(
    async (appointmentId: string, newSlotId: string) => {
      if (!session) return;
      setActionLoading(true);
      try {
        await rescheduleAppointment(appointmentId, newSlotId, session.accessToken);
        await load();
      } finally {
        setActionLoading(false);
      }
    },
    [load, session],
  );

  const submitReview = useCallback(
    async (input: { providerId: string; targetId: string; rating: number; comment: string }) => {
      if (!user || !session) return 'error';
      setActionLoading(true);
      try {
        const result = await submitAppointmentReview({
          customerId: user.id,
          providerId: input.providerId,
          targetId: input.targetId,
          rating: input.rating,
          comment: input.comment,
          accessToken: session.accessToken,
        });
        await load();
        return result;
      } finally {
        setActionLoading(false);
      }
    },
    [load, session, user],
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
