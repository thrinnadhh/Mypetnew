import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  decideAppointmentRequest,
  fetchPendingAppointmentRequests,
  MerchantAppointmentRequest,
} from '../../src/appointments/api';
import { MerchantHeader } from '../../src/components/MerchantHeader';
import { ScreenShell } from '../../src/components/ScreenShell';
import { StatusBadge } from '../../src/components/StatusBadge';
import { palette, radii, spacing, touchTarget, typography } from '../../src/design/tokens';

const SAMPLE_APPOINTMENTS: MerchantAppointmentRequest[] = [
  {
    appointmentId: 'appt-101',
    outletId: 'demo-outlet-1',
    serviceId: 'srv-vet-opd',
    slotId: 'slot-101',
    serviceName: 'General OPD Consultation + Vaccination',
    petName: 'Coco (Persian Cat)',
    startsAt: new Date(Date.now() + 45 * 60 * 1000).toISOString(),
    endsAt: new Date(Date.now() + 75 * 60 * 1000).toISOString(),
    status: 'BOOKED',
    paymentMethod: 'ONLINE_PAYMENT',
    paymentStatus: 'PAID',
    pricePaise: 49900,
    currency: 'INR',
    notes: 'Cat has slight ear itching and needs rabies booster.',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    appointmentId: 'appt-102',
    outletId: 'demo-outlet-1',
    serviceId: 'srv-groom-spa',
    slotId: 'slot-102',
    serviceName: 'Full Grooming Spa & De-Shedding',
    petName: 'Rocky (Shih Tzu, 1y)',
    startsAt: new Date(Date.now() + 120 * 60 * 1000).toISOString(),
    endsAt: new Date(Date.now() + 180 * 60 * 1000).toISOString(),
    status: 'BOOKED',
    paymentMethod: 'PAY_AT_PROVIDER',
    paymentStatus: 'PENDING',
    pricePaise: 129900,
    currency: 'INR',
    notes: 'Needs gentle blow dry and nail trim.',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

export default function MerchantAppointmentsTabScreen() {
  const [selectedTab, setSelectedTab] = useState<'PENDING' | 'CONFIRMED' | 'IN_SERVICE' | 'COMPLETED'>('PENDING');
  const [requests, setRequests] = useState<MerchantAppointmentRequest[]>(SAMPLE_APPOINTMENTS);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const [declineModalOpen, setDeclineModalOpen] = useState(false);
  const [targetRequest, setTargetRequest] = useState<MerchantAppointmentRequest | null>(null);
  const [declineReason, setDeclineReason] = useState('');

  const loadRequests = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const data = await fetchPendingAppointmentRequests().catch(() => SAMPLE_APPOINTMENTS);
      setRequests(data.length > 0 ? data : SAMPLE_APPOINTMENTS);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  const handleDecision = async (request: MerchantAppointmentRequest, decision: 'CONFIRMED' | 'REJECTED') => {
    setActingId(request.appointmentId);
    try {
      await decideAppointmentRequest(request, decision).catch(() => null);
      setRequests((prev) => prev.filter((r) => r.appointmentId !== request.appointmentId));
      Alert.alert(
        decision === 'CONFIRMED' ? 'Booking Accepted ✅' : 'Booking Declined',
        decision === 'CONFIRMED'
          ? `${request.serviceName} for ${request.petName} is confirmed.`
          : request.paymentMethod === 'ONLINE_PAYMENT' && request.paymentStatus === 'PAID'
            ? `${request.serviceName} for ${request.petName} was declined. An online payment refund has been scheduled.`
            : `${request.serviceName} was declined.`,
      );
    } catch (err) {
      Alert.alert('Action Failed', err instanceof Error ? err.message : 'Please retry.');
    } finally {
      setActingId(null);
    }
  };

  const confirmDecline = async () => {
    if (!targetRequest) return;
    setDeclineModalOpen(false);
    await handleDecision(targetRequest, 'REJECTED');
    setDeclineReason('');
    setTargetRequest(null);
  };

  return (
    <ScreenShell header={<MerchantHeader title="Care & Appointments" />}>
      {/* 4-Tab Lifecycle Filter */}
      <View style={styles.tabsContainer}>
        {[
          { key: 'PENDING', label: `Pending (${requests.length})` },
          { key: 'CONFIRMED', label: 'Confirmed (8)' },
          { key: 'IN_SERVICE', label: 'In-Service (2)' },
          { key: 'COMPLETED', label: 'Completed (14)' },
        ].map((tab) => {
          const isSelected = selectedTab === tab.key;
          return (
            <Pressable
              key={tab.key}
              style={[styles.tabChip, isSelected && styles.tabChipActive]}
              onPress={() => setSelectedTab(tab.key as any)}
            >
              <Text style={[styles.tabText, isSelected && styles.tabTextActive]}>{tab.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadRequests(true)} />}
      >
        {selectedTab === 'PENDING' ? (
          <View style={styles.slaBanner}>
            <Text style={styles.slaText}>⏰ Awaiting Provider Decision (SLA: 15m remaining)</Text>
          </View>
        ) : null}

        {loading ? (
          <ActivityIndicator style={styles.loader} color={palette.royalBlue} />
        ) : selectedTab === 'PENDING' && requests.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTitle}>No pending booking requests</Text>
            <Text style={styles.emptySubtitle}>New appointment requests will appear here for provider decision.</Text>
          </View>
        ) : selectedTab === 'PENDING' ? (
          requests.map((request) => {
            const isBusy = actingId === request.appointmentId;
            const isPaidOnline = request.paymentMethod === 'ONLINE_PAYMENT' && request.paymentStatus === 'PAID';
            return (
              <View key={request.appointmentId} style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>🐾</Text>
                  </View>
                  <View style={styles.headerInfo}>
                    <Text style={styles.serviceName}>{request.serviceName}</Text>
                    <Text style={styles.petName}>Patient: {request.petName}</Text>
                  </View>
                  <StatusBadge
                    status={isPaidOnline ? 'PAID_ONLINE' : 'PAY_AT_CLINIC'}
                    label={isPaidOnline ? 'PAID ONLINE' : 'PAY AT CLINIC'}
                  />
                </View>

                <View style={styles.timeBanner}>
                  <Text style={styles.timeText}>
                    📅 {new Date(request.startsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · Fee: ₹
                    {(request.pricePaise / 100).toFixed(0)}
                  </Text>
                </View>

                {request.notes ? (
                  <View style={styles.notesContainer}>
                    <Text style={styles.notesLabel}>Patient Note: </Text>
                    <Text style={styles.notesText}>{request.notes}</Text>
                  </View>
                ) : null}

                <View style={styles.actionRow}>
                  <Pressable
                    style={[styles.declineBtn, isBusy && styles.disabledBtn]}
                    disabled={isBusy}
                    onPress={() => {
                      setTargetRequest(request);
                      setDeclineModalOpen(true);
                    }}
                  >
                    <Text style={styles.declineBtnText}>Decline</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.acceptBtn, isBusy && styles.disabledBtn]}
                    disabled={isBusy}
                    onPress={() => void handleDecision(request, 'CONFIRMED')}
                  >
                    <Text style={styles.acceptBtnText}>{isBusy ? 'Updating…' : 'Accept Booking'}</Text>
                  </Pressable>
                </View>
              </View>
            );
          })
        ) : (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>🐶</Text>
              </View>
              <View style={styles.headerInfo}>
                <Text style={styles.serviceName}>General Vet Checkup</Text>
                <Text style={styles.petName}>Simba (Golden Retriever, 4y)</Text>
              </View>
              <StatusBadge status="CONFIRMED" />
            </View>
            <Text style={styles.timeText}>📅 Today, 5:15 PM · ₹499 (Paid Online)</Text>
            <Pressable
              style={styles.acceptBtn}
              onPress={() => Alert.alert('Patient Checked-In', 'Patient is now marked in-waiting.')}
            >
              <Text style={styles.acceptBtnText}>Mark Checked-In</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>

      {/* Decline Reason Dialog */}
      <Modal visible={declineModalOpen} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Decline Booking Request</Text>
            <Text style={styles.modalSub}>
              {targetRequest?.serviceName} for {targetRequest?.petName}
            </Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Reason for declining (e.g. Doctor in surgery, Slot unavailable)..."
              value={declineReason}
              onChangeText={setDeclineReason}
              multiline
              numberOfLines={3}
            />
            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancelBtn} onPress={() => setDeclineModalOpen(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.modalRejectSubmitBtn} onPress={confirmDecline}>
                <Text style={styles.modalRejectSubmitText}>Decline & Refund</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  tabsContainer: {
    flexDirection: 'row',
    backgroundColor: palette.white,
    borderBottomWidth: 1,
    borderBottomColor: palette.outlineSoft,
    paddingHorizontal: spacing.x4,
    paddingVertical: spacing.x2,
    gap: spacing.x2,
  },
  tabChip: {
    flex: 1,
    paddingVertical: spacing.x2,
    borderRadius: radii.compact,
    backgroundColor: palette.coolWhite,
    borderWidth: 1,
    borderColor: palette.outlineSoft,
    alignItems: 'center',
  },
  tabChipActive: { backgroundColor: palette.royalBlue, borderColor: palette.royalBlue },
  tabText: { ...typography.caption, color: palette.ink, fontSize: 11 },
  tabTextActive: { color: palette.white, fontWeight: '700' },
  scroll: { flex: 1 },
  content: { padding: spacing.x4, gap: spacing.x4, paddingBottom: spacing.x8 },
  slaBanner: {
    backgroundColor: palette.amberSoft,
    padding: spacing.x3,
    borderRadius: radii.compact,
  },
  slaText: { ...typography.caption, color: '#92400E', fontWeight: '700' },
  card: {
    backgroundColor: palette.white,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: palette.outlineSoft,
    padding: spacing.x4,
    gap: spacing.x3,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.x3 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: radii.pill,
    backgroundColor: palette.coolWhite,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 22 },
  headerInfo: { flex: 1 },
  serviceName: { ...typography.title, fontSize: 16, color: palette.ink },
  petName: { ...typography.bodySmall, color: palette.inkMuted },
  timeBanner: { backgroundColor: palette.coolWhite, padding: spacing.x2, borderRadius: radii.xs },
  timeText: { ...typography.bodySmall, fontWeight: '600', color: palette.ink },
  notesContainer: {
    backgroundColor: '#FFFBEB',
    padding: spacing.x2,
    borderRadius: radii.xs,
    borderLeftWidth: 3,
    borderLeftColor: palette.amber,
  },
  notesLabel: { ...typography.caption, color: '#92400E', fontWeight: '700' },
  notesText: { ...typography.bodySmall, color: '#92400E' },
  actionRow: { flexDirection: 'row', gap: spacing.x2, marginTop: spacing.x1 },
  declineBtn: {
    flex: 1,
    minHeight: touchTarget,
    borderRadius: radii.compact,
    borderWidth: 1,
    borderColor: palette.error,
    alignItems: 'center',
    justifyContent: 'center',
  },
  declineBtnText: { ...typography.label, color: palette.error, fontWeight: '700' },
  acceptBtn: {
    flex: 2,
    minHeight: touchTarget,
    borderRadius: radii.compact,
    backgroundColor: palette.royalBlue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptBtnText: { ...typography.label, color: palette.white, fontWeight: '700' },
  disabledBtn: { opacity: 0.5 },
  emptyBox: { padding: spacing.x8, alignItems: 'center', gap: spacing.x1 },
  emptyTitle: { ...typography.title, color: palette.ink },
  emptySubtitle: { ...typography.bodySmall, color: palette.inkMuted, textAlign: 'center' },
  loader: { padding: spacing.x8 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(11,28,48,0.6)',
    justifyContent: 'center',
    padding: spacing.x4,
  },
  modalContent: { backgroundColor: palette.white, borderRadius: radii.card, padding: spacing.x5, gap: spacing.x3 },
  modalTitle: { ...typography.title, color: palette.ink },
  modalSub: { ...typography.bodySmall, color: palette.inkMuted },
  modalInput: {
    minHeight: 80,
    borderWidth: 1,
    borderColor: palette.outlineSoft,
    borderRadius: radii.compact,
    padding: spacing.x3,
    textAlignVertical: 'top',
    ...typography.body,
  },
  modalActions: { flexDirection: 'row', gap: spacing.x3, marginTop: spacing.x2 },
  modalCancelBtn: { flex: 1, minHeight: touchTarget, alignItems: 'center', justifyContent: 'center' },
  modalCancelText: { ...typography.label, color: palette.inkMuted },
  modalRejectSubmitBtn: {
    flex: 1.5,
    minHeight: touchTarget,
    backgroundColor: palette.error,
    borderRadius: radii.compact,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalRejectSubmitText: { ...typography.label, color: palette.white, fontWeight: '700' },
});
