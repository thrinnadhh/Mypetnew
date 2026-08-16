import { Link } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Button,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  decideAppointmentRequest,
  fetchPendingAppointmentRequests,
  type MerchantAppointmentRequest,
} from '../src/appointments/api';
import { hasRuntimeMerchantSession } from '../src/auth/session';

type LoadState = 'loading' | 'ready' | 'error' | 'unauthenticated';

const BOOKING_REQUEST_REFRESH_MS = 15_000;

function money(paise: number): string {
  return `₹${(paise / 100).toFixed(2)}`;
}

function schedule(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Time unavailable'
    : new Intl.DateTimeFormat('en-IN', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
      }).format(date);
}

export default function MerchantAppointmentsScreen() {
  const [requests, setRequests] = useState<MerchantAppointmentRequest[]>([]);
  const [state, setState] = useState<LoadState>(hasRuntimeMerchantSession() ? 'loading' : 'unauthenticated');
  const [refreshing, setRefreshing] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    if (!hasRuntimeMerchantSession()) {
      setState('unauthenticated');
      return;
    }
    if (refresh) setRefreshing(true);
    else setState('loading');
    try {
      setRequests(await fetchPendingAppointmentRequests());
      setState('ready');
    } catch (error) {
      const authFailure = error instanceof Error
        && /AUTHENTICATION_REQUIRED|SESSION_INVALID|REFRESH_TOKEN_INVALID/.test(`${error.name} ${error.message}`);
      setState(authFailure ? 'unauthenticated' : 'error');
    } finally {
      setRefreshing(false);
    }
  }, []);

  const refreshSilently = useCallback(async () => {
    if (!hasRuntimeMerchantSession()) return;
    try {
      setRequests(await fetchPendingAppointmentRequests());
    } catch {
      // Keep the last known inbox during transient background failures. Explicit
      // pull-to-refresh/retry still surfaces canonical API errors to the merchant.
    }
  }, []);

  useEffect(() => {
    const startup = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(startup);
  }, [load]);

  useEffect(() => {
    if (state !== 'ready') return undefined;
    const timer = setInterval(() => {
      void refreshSilently();
    }, BOOKING_REQUEST_REFRESH_MS);
    return () => clearInterval(timer);
  }, [refreshSilently, state]);

  const decide = async (request: MerchantAppointmentRequest, decision: 'CONFIRMED' | 'REJECTED') => {
    if (actingId) return;
    setActingId(request.appointmentId);
    try {
      await decideAppointmentRequest(request, decision);
      setRequests((current) => current.filter((item) => item.appointmentId !== request.appointmentId));
      Alert.alert(
        decision === 'CONFIRMED' ? 'Booking accepted' : 'Booking declined',
        decision === 'CONFIRMED'
          ? `${request.serviceName} for ${request.petName} is now confirmed for the customer.`
          : `${request.serviceName} for ${request.petName} was declined and is no longer pending.`,
      );
    } catch (error) {
      Alert.alert(
        decision === 'CONFIRMED' ? 'Could not accept booking' : 'Could not decline booking',
        error instanceof Error ? error.message : 'Please retry.',
      );
      await load(true);
    } finally {
      setActingId(null);
    }
  };

  return (
    <SafeAreaView style={styles.page}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>Booking requests</Text>
          <Text style={styles.subtitle}>Accept or reject grooming and veterinary requests before the customer sees Confirmed.</Text>
        </View>
        <Link href="/" accessibilityRole="button" style={styles.backLink}>Home</Link>
      </View>

      {state === 'unauthenticated' ? (
        <View style={styles.stateBox}>
          <Text style={styles.stateTitle}>Merchant sign-in required</Text>
          <Text style={styles.body}>Sign in with your authorized Merchant account to manage booking requests.</Text>
          <Link href="/login" accessibilityRole="button" style={styles.link}>Sign in</Link>
        </View>
      ) : null}

      {state === 'loading' ? (
        <View style={styles.stateBox}>
          <ActivityIndicator />
          <Text style={styles.body}>Loading new booking requests…</Text>
        </View>
      ) : null}

      {state === 'error' ? (
        <View style={styles.stateBox}>
          <Text style={styles.stateTitle}>Could not load requests</Text>
          <Text style={styles.body}>Reconnect and retry. No booking decision was changed.</Text>
          <Button title="Retry" onPress={() => void load()} />
        </View>
      ) : null}

      {state === 'ready' ? (
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} />}
        >
          {requests.length === 0 ? (
            <View style={styles.stateBox}>
              <Text style={styles.stateTitle}>No pending requests</Text>
              <Text style={styles.body}>New customer booking requests will appear here for provider confirmation.</Text>
            </View>
          ) : null}

          {requests.map((request) => {
            const busy = actingId === request.appointmentId;
            return (
              <View key={request.appointmentId} style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={styles.flex}>
                    <Text style={styles.service}>{request.serviceName}</Text>
                    <Text style={styles.pet}>Pet: {request.petName}</Text>
                  </View>
                  <View style={styles.pendingPill}>
                    <Text style={styles.pendingText}>NEW REQUEST</Text>
                  </View>
                </View>

                <Text style={styles.schedule}>{schedule(request.startsAt)}</Text>
                <Text style={styles.fee}>{money(request.pricePaise)} · Pay at provider</Text>
                {request.notes ? <Text style={styles.notes}>Customer note: {request.notes}</Text> : null}

                <View style={styles.actions}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Decline ${request.serviceName} for ${request.petName}`}
                    disabled={Boolean(actingId)}
                    onPress={() => void decide(request, 'REJECTED')}
                    style={({ pressed }) => [styles.rejectButton, (pressed || Boolean(actingId)) && styles.disabled]}
                  >
                    <Text style={styles.rejectText}>{busy ? 'Updating…' : 'Reject'}</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Accept ${request.serviceName} for ${request.petName}`}
                    disabled={Boolean(actingId)}
                    onPress={() => void decide(request, 'CONFIRMED')}
                    style={({ pressed }) => [styles.acceptButton, (pressed || Boolean(actingId)) && styles.disabled]}
                  >
                    <Text style={styles.acceptText}>{busy ? 'Updating…' : 'Accept booking'}</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f8fafc' },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  headerText: { flex: 1, gap: 4 },
  title: { fontSize: 26, lineHeight: 32, fontWeight: '800', color: '#111827' },
  subtitle: { fontSize: 14, lineHeight: 20, color: '#64748b' },
  backLink: { color: '#2563eb', fontWeight: '700', paddingVertical: 8 },
  link: { color: '#2563eb', fontWeight: '700', padding: 8 },
  list: { flex: 1 },
  listContent: { padding: 20, paddingTop: 8, gap: 14, paddingBottom: 40 },
  stateBox: { margin: 20, padding: 24, borderRadius: 16, backgroundColor: '#ffffff', alignItems: 'center', gap: 10 },
  stateTitle: { fontSize: 18, fontWeight: '800', color: '#111827' },
  body: { fontSize: 15, lineHeight: 21, color: '#64748b', textAlign: 'center' },
  card: { backgroundColor: '#ffffff', borderRadius: 16, padding: 16, gap: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: '#dbe2ea' },
  cardHeader: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  flex: { flex: 1 },
  service: { fontSize: 18, lineHeight: 24, fontWeight: '800', color: '#111827' },
  pet: { marginTop: 3, fontSize: 14, color: '#64748b' },
  pendingPill: { backgroundColor: '#fef3c7', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  pendingText: { color: '#92400e', fontSize: 11, fontWeight: '800' },
  schedule: { fontSize: 15, lineHeight: 21, fontWeight: '700', color: '#334155' },
  fee: { fontSize: 14, color: '#475569' },
  notes: { padding: 10, borderRadius: 10, backgroundColor: '#f8fafc', color: '#475569', fontSize: 14, lineHeight: 20 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  rejectButton: { flex: 1, minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: '#dc2626', alignItems: 'center', justifyContent: 'center' },
  rejectText: { color: '#dc2626', fontWeight: '800' },
  acceptButton: { flex: 1.5, minHeight: 48, borderRadius: 12, backgroundColor: '#16a34a', alignItems: 'center', justifyContent: 'center' },
  acceptText: { color: '#ffffff', fontWeight: '800' },
  disabled: { opacity: 0.55 },
});
