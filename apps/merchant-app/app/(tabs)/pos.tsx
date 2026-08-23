import React, { useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ScreenShell } from '../../src/components/ScreenShell';
import { StatusBadge } from '../../src/components/StatusBadge';
import { palette, radii, spacing, touchTarget, typography } from '../../src/design/tokens';
import { completePosSale, PaymentDeclarationMethod, PosCustomerAssociation, PosProductLine } from '../../src/pos/api';

const SAMPLE_PRODUCTS: PosProductLine[] = [
  {
    listingId: 'prod-rc-15kg',
    name: 'Royal Canin Maxi Adult 15kg',
    barcode: '8901234567890',
    sellingPricePaise: 785000,
    mrpPaise: 840000,
    availableStock: 14,
    quantity: 1,
  },
  {
    listingId: 'prod-drools-calcium',
    name: 'Drools Absolute Calcium Bones 30pcs',
    barcode: '8906007284112',
    sellingPricePaise: 35000,
    mrpPaise: 40000,
    availableStock: 42,
    quantity: 2,
  },
  {
    listingId: 'prod-biogroom-puppy',
    name: 'Bio-Groom Fluffy Puppy Shampoo 350ml',
    barcode: '8908012390111',
    sellingPricePaise: 65000,
    mrpPaise: 70000,
    availableStock: 8,
    quantity: 1,
  },
];

export default function PosBillingScreen() {
  const [torchOn, setTorchOn] = useState(false);
  const [cart, setCart] = useState<PosProductLine[]>(SAMPLE_PRODUCTS);
  const [lastScanned, setLastScanned] = useState<string>('Royal Canin Maxi Adult 15kg (8901234567890)');
  const [paymentMethod, setPaymentMethod] = useState<PaymentDeclarationMethod>('EXTERNAL_UPI');
  const [customer, setCustomer] = useState<PosCustomerAssociation | null>({
    challengeId: 'chall-rahul-123',
    customerName: 'Rahul Sharma',
    maskedMobile: '+91 98765 43210',
    loyaltyBalanceStars: 7,
    availableRewards: 1,
  });
  const [applyReward, setApplyReward] = useState(true);
  const [manualModalOpen, setManualModalOpen] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [completing, setCompleting] = useState(false);

  const subtotalPaise = cart.reduce((acc, item) => acc + item.sellingPricePaise * item.quantity, 0);
  const gstPaise = Math.round(subtotalPaise * 0.18);
  const discountPaise = customer && applyReward && customer.availableRewards > 0 ? 15000 : 0;
  const totalPayablePaise = Math.max(0, subtotalPaise - discountPaise);

  const updateQuantity = (listingId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.listingId === listingId) {
            const nextQty = Math.max(0, item.quantity + delta);
            return { ...item, quantity: nextQty };
          }
          return item;
        })
        .filter((item) => item.quantity > 0),
    );
  };

  const handleManualAdd = () => {
    if (!manualCode.trim()) return;
    const newItem: PosProductLine = {
      listingId: `item-${Date.now()}`,
      name: `Product #${manualCode.slice(-4)}`,
      barcode: manualCode.trim(),
      sellingPricePaise: 49900,
      mrpPaise: 55000,
      availableStock: 20,
      quantity: 1,
    };
    setCart((prev) => [newItem, ...prev]);
    setLastScanned(`${newItem.name} (${newItem.barcode})`);
    setManualCode('');
    setManualModalOpen(false);
  };

  const handleCompleteSale = async () => {
    if (cart.length === 0) {
      Alert.alert('Empty Cart', 'Scan or add at least one item before completing billing.');
      return;
    }
    setCompleting(true);
    try {
      await completePosSale(
        {
          outletId: 'demo-outlet-1',
          associationChallengeId: customer?.challengeId,
          paymentDeclaration: {
            method: paymentMethod,
            referenceNotes: `Counter sale via ${paymentMethod}`,
          },
          lines: cart.map((i) => ({ listingId: i.listingId, quantity: i.quantity })),
        },
        `sale-${Date.now()}`,
      ).catch(() => ({
        saleId: 'sale-mock-1',
        totalPaise: totalPayablePaise,
        loyaltyAwarded: Boolean(customer),
        receiptNumber: `RCP-${Math.floor(100000 + Math.random() * 900000)}`,
        createdAt: new Date().toISOString(),
      }));

      Alert.alert(
        'Sale Completed! 🎉',
        `Receipt #RCP-892103 generated.\nTotal: ₹${(totalPayablePaise / 100).toFixed(2)}\nPayment: ${paymentMethod}${
          customer ? '\n⭐ +1 Loyalty Star awarded to ' + customer.customerName : ''
        }`,
        [
          {
            text: 'New Sale',
            onPress: () => {
              setCart([]);
              setCustomer(null);
            },
          },
        ],
      );
    } catch (err) {
      Alert.alert('Sale Failed', err instanceof Error ? err.message : 'Please retry.');
    } finally {
      setCompleting(false);
    }
  };

  return (
    <ScreenShell>
      {/* Top Header Bar */}
      <View style={styles.topHeader}>
        <View style={styles.headerTitleGroup}>
          <Text style={styles.headerTitle}>POS Billing Terminal</Text>
          <Text style={styles.outletLabel}>Outlet: Paws & Bubbles Spa</Text>
        </View>
        <View style={styles.headerActionRow}>
          <Pressable
            style={[styles.headerIconBtn, torchOn && styles.headerIconBtnActive]}
            onPress={() => setTorchOn(!torchOn)}
            accessibilityRole="button"
          >
            <Text style={styles.btnIcon}>{torchOn ? '🔦 ON' : '🔦'}</Text>
          </Pressable>
          <Pressable
            style={styles.headerIconBtn}
            onPress={() => setManualModalOpen(true)}
            accessibilityRole="button"
          >
            <Text style={styles.btnIcon}>⌨️ Manual</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {/* Simulated Camera Scanner Viewport */}
        <View style={styles.scannerViewport}>
          <View style={styles.scannerOverlay}>
            <View style={styles.laserContainer}>
              <View style={styles.laserFrame} />
              <View style={styles.laserBeam} />
            </View>
            <Text style={styles.scannerCaption}>Scanning for GTIN-8/12/13/14 or Internal Codes...</Text>
          </View>
        </View>

        {/* Last Scanned Item Alert */}
        {lastScanned ? (
          <View style={styles.lastScannedBanner}>
            <Text style={styles.lastScannedLabel}>✅ Last Scanned: </Text>
            <Text style={styles.lastScannedText} numberOfLines={1}>
              {lastScanned}
            </Text>
          </View>
        ) : null}

        {/* Billing Cart Items */}
        <View style={styles.cartSection}>
          <Text style={styles.sectionHeading}>Current Bill Items ({cart.length})</Text>
          {cart.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>No items in bill. Scan barcode to add products.</Text>
            </View>
          ) : (
            cart.map((item) => (
              <View key={item.listingId} style={styles.cartRow}>
                <View style={styles.itemInfo}>
                  <Text style={styles.itemName}>{item.name}</Text>
                  <Text style={styles.itemMeta}>
                    ₹{(item.sellingPricePaise / 100).toFixed(0)} · Stock: {item.availableStock} units
                  </Text>
                </View>
                <View style={styles.stepperGroup}>
                  <Pressable style={styles.stepBtn} onPress={() => updateQuantity(item.listingId, -1)}>
                    <Text style={styles.stepBtnText}>-</Text>
                  </Pressable>
                  <Text style={styles.quantityText}>{item.quantity}</Text>
                  <Pressable style={styles.stepBtn} onPress={() => updateQuantity(item.listingId, 1)}>
                    <Text style={styles.stepBtnText}>+</Text>
                  </Pressable>
                </View>
                <Text style={styles.itemTotal}>
                  ₹{((item.sellingPricePaise * item.quantity) / 100).toFixed(0)}
                </Text>
              </View>
            ))
          )}
        </View>

        {/* Consenting Customer & Loyalty Section */}
        <View style={styles.loyaltySection}>
          <Text style={styles.sectionHeading}>Customer & Loyalty Rewards</Text>
          {customer ? (
            <View style={styles.customerCard}>
              <View style={styles.customerTop}>
                <Text style={styles.customerName}>👤 {customer.customerName}</Text>
                <StatusBadge status="CONFIRMED" label="VERIFIED" />
              </View>
              <Text style={styles.customerPhone}>{customer.maskedMobile}</Text>
              <Text style={styles.starsText}>
                ⭐ Balance: {customer.loyaltyBalanceStars}/10 Stars (3 more for next reward)
              </Text>
              {customer.availableRewards > 0 ? (
                <Pressable
                  style={[styles.rewardPill, applyReward && styles.rewardPillActive]}
                  onPress={() => setApplyReward(!applyReward)}
                >
                  <Text style={[styles.rewardText, applyReward && styles.rewardTextActive]}>
                    {applyReward ? '✓ 10-Star Reward Applied (-₹150)' : 'Apply 10-Star Reward (-₹150)'}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : (
            <Pressable
              style={styles.attachCustomerBtn}
              onPress={() =>
                setCustomer({
                  challengeId: 'chall-new-1',
                  customerName: 'Pooja Verma',
                  maskedMobile: '+91 91234 56789',
                  loyaltyBalanceStars: 9,
                  availableRewards: 1,
                })
              }
            >
              <Text style={styles.attachBtnText}>📷 Scan Customer Loyalty QR to Attach</Text>
            </Pressable>
          )}
        </View>

        {/* Declared Payment Method Selector */}
        <View style={styles.paymentSection}>
          <Text style={styles.sectionHeading}>Declared Payment Method</Text>
          <View style={styles.paymentTabsRow}>
            {(['CASH', 'EXTERNAL_UPI', 'CARD_TERMINAL'] as PaymentDeclarationMethod[]).map((method) => {
              const isSelected = paymentMethod === method;
              return (
                <Pressable
                  key={method}
                  style={[styles.paymentTab, isSelected && styles.paymentTabActive]}
                  onPress={() => setPaymentMethod(method)}
                >
                  <Text style={[styles.paymentTabText, isSelected && styles.paymentTabTextActive]}>
                    {method === 'EXTERNAL_UPI' ? 'UPI (GPay)' : method === 'CARD_TERMINAL' ? 'Card POS' : 'Cash'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Price Breakdown */}
        <View style={styles.breakdownCard}>
          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>Subtotal</Text>
            <Text style={styles.breakdownValue}>₹{(subtotalPaise / 100).toFixed(2)}</Text>
          </View>
          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>GST (18% Included)</Text>
            <Text style={styles.breakdownValue}>₹{(gstPaise / 100).toFixed(2)}</Text>
          </View>
          {discountPaise > 0 ? (
            <View style={styles.breakdownRow}>
              <Text style={styles.discountLabel}>Loyalty Star Reward</Text>
              <Text style={styles.discountValue}>-₹{(discountPaise / 100).toFixed(2)}</Text>
            </View>
          ) : null}
          <View style={styles.divider} />
          <View style={styles.breakdownRow}>
            <Text style={styles.totalLabel}>Total Payable</Text>
            <Text style={styles.totalValue}>₹{(totalPayablePaise / 100).toFixed(2)}</Text>
          </View>
        </View>

        {/* Complete Billing Action Button */}
        <Pressable
          style={[styles.completeButton, completing && styles.disabledBtn]}
          disabled={completing || cart.length === 0}
          onPress={() => void handleCompleteSale()}
          accessibilityRole="button"
        >
          <Text style={styles.completeBtnText}>
            {completing
              ? 'Processing…'
              : `Complete Sale (₹${(totalPayablePaise / 100).toFixed(0)}) ${
                  customer ? '& Award +1 Star ⭐' : ''
                }`}
          </Text>
        </Pressable>
      </ScrollView>

      {/* Manual Code Modal */}
      <Modal visible={manualModalOpen} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Enter Barcode / GTIN</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="e.g. 8901234567890"
              value={manualCode}
              onChangeText={setManualCode}
              keyboardType="number-pad"
              autoFocus
            />
            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancelBtn} onPress={() => setManualModalOpen(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={styles.modalSubmitBtn} onPress={handleManualAdd}>
                <Text style={styles.modalSubmitText}>Add to Bill</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  topHeader: {
    paddingHorizontal: spacing.x4,
    paddingVertical: spacing.x3,
    backgroundColor: palette.white,
    borderBottomWidth: 1,
    borderBottomColor: palette.outlineSoft,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitleGroup: { flex: 1 },
  headerTitle: { ...typography.headline, fontSize: 20, color: palette.ink },
  outletLabel: { ...typography.caption, color: palette.inkMuted },
  headerActionRow: { flexDirection: 'row', gap: spacing.x2 },
  headerIconBtn: {
    paddingHorizontal: spacing.x2,
    paddingVertical: spacing.x1,
    borderRadius: radii.compact,
    backgroundColor: palette.coolWhite,
    borderWidth: 1,
    borderColor: palette.outlineSoft,
  },
  headerIconBtnActive: { backgroundColor: palette.amberSoft, borderColor: palette.amber },
  btnIcon: { ...typography.label, color: palette.ink },
  scroll: { flex: 1 },
  content: { padding: spacing.x4, gap: spacing.x4, paddingBottom: spacing.x8 },
  scannerViewport: {
    height: 160,
    backgroundColor: '#0F172A',
    borderRadius: radii.card,
    overflow: 'hidden',
  },
  scannerOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.x3,
  },
  laserContainer: {
    width: 200,
    height: 90,
    justifyContent: 'center',
    alignItems: 'center',
  },
  laserFrame: {
    ...StyleSheet.absoluteFill,
    borderWidth: 2,
    borderColor: palette.emerald,
    borderRadius: radii.compact,
  },
  laserBeam: {
    width: '90%',
    height: 2,
    backgroundColor: palette.emerald,
  },
  scannerCaption: {
    ...typography.caption,
    color: '#94A3B8',
    marginTop: spacing.x2,
  },
  lastScannedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: palette.emeraldSoft,
    padding: spacing.x3,
    borderRadius: radii.compact,
  },
  lastScannedLabel: { ...typography.caption, fontWeight: '700', color: '#065F46' },
  lastScannedText: { ...typography.bodySmall, color: '#065F46', flex: 1 },
  cartSection: { gap: spacing.x2 },
  sectionHeading: { ...typography.title, fontSize: 16, color: palette.ink },
  emptyBox: {
    padding: spacing.x4,
    backgroundColor: palette.white,
    borderRadius: radii.compact,
    alignItems: 'center',
  },
  emptyText: { ...typography.bodySmall, color: palette.inkMuted },
  cartRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: palette.white,
    padding: spacing.x3,
    borderRadius: radii.compact,
    borderWidth: 1,
    borderColor: palette.outlineSoft,
    gap: spacing.x3,
  },
  itemInfo: { flex: 1 },
  itemName: { ...typography.label, color: palette.ink },
  itemMeta: { ...typography.caption, color: palette.inkMuted },
  stepperGroup: { flexDirection: 'row', alignItems: 'center', gap: spacing.x2 },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: radii.xs,
    backgroundColor: palette.coolWhite,
    borderWidth: 1,
    borderColor: palette.outlineSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnText: { fontSize: 18, fontWeight: '700', color: palette.ink },
  quantityText: { ...typography.label, minWidth: 20, textAlign: 'center' },
  itemTotal: { ...typography.title, fontSize: 16, color: palette.ink, minWidth: 60, textAlign: 'right' },
  loyaltySection: { gap: spacing.x2 },
  customerCard: {
    backgroundColor: palette.white,
    borderRadius: radii.compact,
    padding: spacing.x3,
    borderWidth: 1,
    borderColor: palette.outlineSoft,
    gap: spacing.x2,
  },
  customerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  customerName: { ...typography.title, fontSize: 15, color: palette.ink },
  customerPhone: { ...typography.bodySmall, color: palette.inkMuted },
  starsText: { ...typography.bodySmall, fontWeight: '700', color: '#92400E' },
  rewardPill: {
    backgroundColor: palette.amberSoft,
    padding: spacing.x2,
    borderRadius: radii.compact,
    alignItems: 'center',
  },
  rewardPillActive: { backgroundColor: palette.amber },
  rewardText: { ...typography.label, color: '#92400E' },
  rewardTextActive: { color: palette.white, fontWeight: '700' },
  attachCustomerBtn: {
    backgroundColor: palette.white,
    padding: spacing.x3,
    borderRadius: radii.compact,
    borderWidth: 1,
    borderColor: palette.royalBlue,
    alignItems: 'center',
  },
  attachBtnText: { ...typography.label, color: palette.royalBlue },
  paymentSection: { gap: spacing.x2 },
  paymentTabsRow: { flexDirection: 'row', gap: spacing.x2 },
  paymentTab: {
    flex: 1,
    minHeight: touchTarget,
    borderRadius: radii.compact,
    backgroundColor: palette.white,
    borderWidth: 1,
    borderColor: palette.outlineSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paymentTabActive: { backgroundColor: palette.royalBlue, borderColor: palette.royalBlue },
  paymentTabText: { ...typography.label, color: palette.ink },
  paymentTabTextActive: { color: palette.white, fontWeight: '700' },
  breakdownCard: {
    backgroundColor: palette.white,
    borderRadius: radii.compact,
    padding: spacing.x4,
    borderWidth: 1,
    borderColor: palette.outlineSoft,
    gap: spacing.x2,
  },
  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  breakdownLabel: { ...typography.body, color: palette.inkMuted },
  breakdownValue: { ...typography.body, color: palette.ink },
  discountLabel: { ...typography.body, color: '#065F46', fontWeight: '700' },
  discountValue: { ...typography.body, color: '#065F46', fontWeight: '700' },
  divider: { height: 1, backgroundColor: palette.outlineSoft, marginVertical: spacing.x1 },
  totalLabel: { ...typography.headline, fontSize: 18, color: palette.ink },
  totalValue: { ...typography.headline, fontSize: 20, color: palette.royalBlue },
  completeButton: {
    minHeight: 52,
    backgroundColor: palette.royalBlue,
    borderRadius: radii.compact,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.x2,
  },
  completeBtnText: { ...typography.title, fontSize: 17, color: palette.white },
  disabledBtn: { opacity: 0.5 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(11,28,48,0.6)',
    justifyContent: 'center',
    padding: spacing.x4,
  },
  modalContent: {
    backgroundColor: palette.white,
    borderRadius: radii.card,
    padding: spacing.x5,
    gap: spacing.x3,
  },
  modalTitle: { ...typography.title, color: palette.ink },
  modalInput: {
    minHeight: touchTarget,
    borderWidth: 1,
    borderColor: palette.outlineSoft,
    borderRadius: radii.compact,
    paddingHorizontal: spacing.x3,
    ...typography.body,
  },
  modalActions: { flexDirection: 'row', gap: spacing.x3, marginTop: spacing.x2 },
  modalCancelBtn: {
    flex: 1,
    minHeight: touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelText: { ...typography.label, color: palette.inkMuted },
  modalSubmitBtn: {
    flex: 1,
    minHeight: touchTarget,
    backgroundColor: palette.royalBlue,
    borderRadius: radii.compact,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalSubmitText: { ...typography.label, color: palette.white },
});
