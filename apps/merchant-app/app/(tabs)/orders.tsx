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
import { MerchantHeader } from '../../src/components/MerchantHeader';
import { ScreenShell } from '../../src/components/ScreenShell';
import { StatusBadge } from '../../src/components/StatusBadge';
import { palette, radii, spacing, touchTarget, typography } from '../../src/design/tokens';
import {
  fetchMerchantOrders,
  MerchantOrderStatus,
  MerchantOrderSummary,
  transitionOrderStatus,
} from '../../src/orders/api';

const SAMPLE_ORDERS: MerchantOrderSummary[] = [
  {
    orderId: 'ord-101',
    outletId: 'demo-outlet-1',
    displayNumber: '#MP-8921',
    status: 'PREPARING',
    fulfilmentMode: 'STORE_PICKUP',
    totalPaise: 245000,
    lines: [
      { listingId: 'p1', name: 'Pedigree Pro Expert Adult 3kg', quantity: 2, unitPricePaise: 110000, totalPaise: 220000 },
      { listingId: 'p2', name: 'Gnawlers Calcium Milk Bones', quantity: 1, unitPricePaise: 25000, totalPaise: 25000 },
    ],
    customerPhoneMasked: '+91 98*** **321',
    placedAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
  },
  {
    orderId: 'ord-102',
    outletId: 'demo-outlet-1',
    displayNumber: '#MP-8922',
    status: 'READY_FOR_PICKUP',
    fulfilmentMode: 'MYPET_CAPTAIN_DELIVERY',
    totalPaise: 185000,
    lines: [
      { listingId: 'p3', name: 'Royal Canin Mini Puppy 2kg', quantity: 1, unitPricePaise: 185000, totalPaise: 185000 },
    ],
    customerPhoneMasked: '+91 94*** **890',
    deliveryAddressSummary: 'Flat 402, Sai Residency, Air Bypass Road, Tirupati',
    placedAt: new Date(Date.now() - 35 * 60 * 1000).toISOString(),
  },
  {
    orderId: 'ord-103',
    outletId: 'demo-outlet-1',
    displayNumber: '#MP-8920',
    status: 'COMPLETED',
    fulfilmentMode: 'STORE_PICKUP',
    totalPaise: 75000,
    lines: [
      { listingId: 'p4', name: 'Captain Groom Anti-Tick Shampoo', quantity: 1, unitPricePaise: 75000, totalPaise: 75000 },
    ],
    placedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  },
];

export default function MerchantOrdersScreen() {
  const [selectedTab, setSelectedTab] = useState<'ALL' | 'PREPARING' | 'READY_FOR_PICKUP' | 'COMPLETED'>('ALL');
  const [orders, setOrders] = useState<MerchantOrderSummary[]>(SAMPLE_ORDERS);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [targetOrder, setTargetOrder] = useState<MerchantOrderSummary | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [transitioningId, setTransitioningId] = useState<string | null>(null);

  const loadOrders = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const result = await fetchMerchantOrders('demo-outlet-1').catch(() => SAMPLE_ORDERS);
      setOrders(result.length > 0 ? result : SAMPLE_ORDERS);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  const handleStatusAdvance = async (order: MerchantOrderSummary, nextStatus: MerchantOrderStatus) => {
    setTransitioningId(order.orderId);
    try {
      await transitionOrderStatus(order.orderId, nextStatus, null, `trans-${Date.now()}`).catch(() => null);
      setOrders((prev) =>
        prev.map((o) => (o.orderId === order.orderId ? { ...o, status: nextStatus } : o)),
      );
      Alert.alert('Order Updated', `Order ${order.displayNumber} moved to ${nextStatus}.`);
    } catch (err) {
      Alert.alert('Update Failed', err instanceof Error ? err.message : 'Please retry.');
    } finally {
      setTransitioningId(null);
    }
  };

  const handleRejectOrder = async () => {
    if (!targetOrder || !rejectReason.trim()) {
      Alert.alert('Reason Required', 'Please provide a reason note for rejecting this order.');
      return;
    }
    setTransitioningId(targetOrder.orderId);
    try {
      await transitionOrderStatus(targetOrder.orderId, 'REJECTED', rejectReason.trim(), `rej-${Date.now()}`).catch(() => null);
      setOrders((prev) =>
        prev.map((o) => (o.orderId === targetOrder.orderId ? { ...o, status: 'REJECTED' } : o)),
      );
      setRejectModalOpen(false);
      setRejectReason('');
      Alert.alert('Order Rejected', `Order ${targetOrder.displayNumber} has been rejected.`);
    } catch (err) {
      Alert.alert('Action Failed', err instanceof Error ? err.message : 'Please retry.');
    } finally {
      setTransitioningId(null);
    }
  };

  const filteredOrders = orders.filter((o) => {
    if (selectedTab === 'ALL') return true;
    if (selectedTab === 'PREPARING') return o.status === 'PREPARING' || o.status === 'PLACED' || o.status === 'CONFIRMED';
    return o.status === selectedTab;
  });

  return (
    <ScreenShell header={<MerchantHeader title="Orders & Fulfilment" />}>
      {/* Filter Tabs */}
      <View style={styles.tabsContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsScroll}>
          {[
            { key: 'ALL', label: `All (${orders.length})` },
            { key: 'PREPARING', label: `Preparing (${orders.filter((o) => o.status === 'PREPARING').length})` },
            { key: 'READY_FOR_PICKUP', label: `Ready (${orders.filter((o) => o.status === 'READY_FOR_PICKUP').length})` },
            { key: 'COMPLETED', label: `Completed (${orders.filter((o) => o.status === 'COMPLETED').length})` },
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
        </ScrollView>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadOrders(true)} />}
      >
        {loading ? (
          <ActivityIndicator style={styles.loader} color={palette.royalBlue} />
        ) : filteredOrders.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>No orders in this category.</Text>
          </View>
        ) : (
          filteredOrders.map((order) => {
            const isBusy = transitioningId === order.orderId;
            const isDelivery = order.fulfilmentMode === 'MYPET_CAPTAIN_DELIVERY';
            return (
              <View key={order.orderId} style={styles.orderCard}>
                <View style={styles.cardHeader}>
                  <View>
                    <Text style={styles.orderNumber}>{order.displayNumber}</Text>
                    <Text style={styles.orderTime}>
                      {new Date(order.placedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  </View>
                  <StatusBadge status={order.status as any} />
                </View>

                {/* Fulfilment Mode Badge */}
                <View style={[styles.fulfilmentBanner, isDelivery ? styles.bannerDelivery : styles.bannerPickup]}>
                  <Text style={[styles.fulfilmentText, isDelivery ? styles.textDelivery : styles.textPickup]}>
                    {isDelivery ? '🛵 Captain Delivery' : '🏬 Store Pickup'}
                  </Text>
                  {order.deliveryAddressSummary ? (
                    <Text style={styles.addressSummary} numberOfLines={1}>
                      {order.deliveryAddressSummary}
                    </Text>
                  ) : null}
                </View>

                {/* Line Items List */}
                <View style={styles.linesList}>
                  {order.lines.map((line, idx) => (
                    <View key={idx} style={styles.lineRow}>
                      <Text style={styles.lineQty}>{line.quantity}x</Text>
                      <Text style={styles.lineName}>{line.name}</Text>
                      <Text style={styles.linePrice}>₹{(line.totalPaise / 100).toFixed(0)}</Text>
                    </View>
                  ))}
                </View>

                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>Total Bill</Text>
                  <Text style={styles.totalValue}>₹{(order.totalPaise / 100).toFixed(2)}</Text>
                </View>

                {/* Action Buttons based on status */}
                <View style={styles.actionsRow}>
                  {order.status === 'PREPARING' || order.status === 'PLACED' ? (
                    <>
                      <Pressable
                        style={styles.rejectBtn}
                        onPress={() => {
                          setTargetOrder(order);
                          setRejectModalOpen(true);
                        }}
                      >
                        <Text style={styles.rejectBtnText}>Decline</Text>
                      </Pressable>
                      <Pressable
                        style={[styles.primaryAdvanceBtn, isBusy && styles.disabledBtn]}
                        disabled={isBusy}
                        onPress={() => void handleStatusAdvance(order, 'READY_FOR_PICKUP')}
                      >
                        <Text style={styles.primaryAdvanceText}>
                          {isBusy ? 'Updating…' : 'Mark Ready for Pickup'}
                        </Text>
                      </Pressable>
                    </>
                  ) : null}

                  {order.status === 'READY_FOR_PICKUP' ? (
                    <Pressable
                      style={[styles.primaryAdvanceBtn, isBusy && styles.disabledBtn]}
                      disabled={isBusy}
                      onPress={() => void handleStatusAdvance(order, 'COMPLETED')}
                    >
                      <Text style={styles.primaryAdvanceText}>
                        {isBusy ? 'Updating…' : isDelivery ? 'Handed Over to Captain' : 'Customer Collected (Complete)'}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      {/* Reject Modal */}
      <Modal visible={rejectModalOpen} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Decline Order {targetOrder?.displayNumber}</Text>
            <Text style={styles.modalSub}>Please provide a reason note for the customer:</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="e.g. Item out of stock or kitchen closed"
              value={rejectReason}
              onChangeText={setRejectReason}
              multiline
              numberOfLines={3}
            />
            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancelBtn} onPress={() => setRejectModalOpen(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.modalRejectSubmitBtn} onPress={handleRejectOrder}>
                <Text style={styles.modalRejectSubmitText}>Confirm Decline</Text>
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
    backgroundColor: palette.white,
    borderBottomWidth: 1,
    borderBottomColor: palette.outlineSoft,
    paddingVertical: spacing.x2,
  },
  tabsScroll: { paddingHorizontal: spacing.x4, gap: spacing.x2 },
  tabChip: {
    paddingHorizontal: spacing.x3,
    paddingVertical: spacing.x1,
    borderRadius: radii.pill,
    backgroundColor: palette.coolWhite,
    borderWidth: 1,
    borderColor: palette.outlineSoft,
  },
  tabChipActive: { backgroundColor: palette.royalBlue, borderColor: palette.royalBlue },
  tabText: { ...typography.label, color: palette.ink },
  tabTextActive: { color: palette.white, fontWeight: '700' },
  scroll: { flex: 1 },
  content: { padding: spacing.x4, gap: spacing.x4, paddingBottom: spacing.x8 },
  orderCard: {
    backgroundColor: palette.white,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: palette.outlineSoft,
    padding: spacing.x4,
    gap: spacing.x3,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  orderNumber: { ...typography.title, fontSize: 18, color: palette.ink },
  orderTime: { ...typography.caption, color: palette.inkMuted },
  fulfilmentBanner: { padding: spacing.x2, borderRadius: radii.compact, gap: 2 },
  bannerPickup: { backgroundColor: palette.emeraldSoft },
  bannerDelivery: { backgroundColor: palette.royalBlueSoft },
  fulfilmentText: { ...typography.label, fontWeight: '700' },
  textPickup: { color: '#065F46' },
  textDelivery: { color: palette.royalBlue },
  addressSummary: { ...typography.caption, color: palette.inkMuted },
  linesList: { gap: spacing.x1, borderTopWidth: 1, borderTopColor: palette.outlineSoft, paddingTop: spacing.x2 },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.x2 },
  lineQty: { ...typography.label, color: palette.royalBlue, minWidth: 24 },
  lineName: { ...typography.bodySmall, color: palette.ink, flex: 1 },
  linePrice: { ...typography.label, color: palette.ink },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: palette.outlineSoft,
    paddingTop: spacing.x2,
  },
  totalLabel: { ...typography.body, fontWeight: '700', color: palette.ink },
  totalValue: { ...typography.title, color: palette.royalBlue },
  actionsRow: { flexDirection: 'row', gap: spacing.x2, marginTop: spacing.x1 },
  rejectBtn: {
    flex: 1,
    minHeight: touchTarget,
    borderRadius: radii.compact,
    borderWidth: 1,
    borderColor: palette.error,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rejectBtnText: { ...typography.label, color: palette.error, fontWeight: '700' },
  primaryAdvanceBtn: {
    flex: 2,
    minHeight: touchTarget,
    borderRadius: radii.compact,
    backgroundColor: palette.royalBlue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryAdvanceText: { ...typography.label, color: palette.white, fontWeight: '700' },
  disabledBtn: { opacity: 0.5 },
  emptyBox: { padding: spacing.x8, alignItems: 'center' },
  emptyText: { ...typography.body, color: palette.inkMuted },
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
