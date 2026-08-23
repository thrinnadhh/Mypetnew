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
  fetchMerchantListings,
  MerchantListingItem,
  receiveStock,
} from '../../src/inventory/api';

const SAMPLE_LISTINGS: MerchantListingItem[] = [
  {
    id: 'list-1',
    name: 'Farmina N&D Grain Free Pumpkin Adult 2.5kg',
    category: 'Dog Food',
    brand: 'Farmina',
    barcode: '8010276033414',
    sku: 'FAR-ND-PUMP-25',
    mrpPaise: 239000,
    sellingPricePaise: 215000,
    availableQuantity: 3,
  },
  {
    id: 'list-2',
    name: 'Drools Absolute Calcium Bone Treats 30pcs',
    category: 'Treats',
    brand: 'Drools',
    barcode: '8906007284112',
    sku: 'DRO-CALC-30P',
    mrpPaise: 40000,
    sellingPricePaise: 35000,
    availableQuantity: 42,
  },
  {
    id: 'list-3',
    name: 'Captain Groom Anti-Tick & Flea Shampoo 500ml',
    category: 'Grooming & Hygiene',
    brand: 'Captain Groom',
    barcode: '8908012390111',
    sku: 'CPT-SHAMP-500',
    mrpPaise: 80000,
    sellingPricePaise: 75000,
    availableQuantity: 0,
  },
  {
    id: 'list-4',
    name: 'PetDr Dewormer Tablets 100mg (10 Tabs)',
    category: 'Medicines',
    brand: 'PetDr',
    barcode: '8909988776655',
    sku: 'PET-MED-DEWORM',
    mrpPaise: 18000,
    sellingPricePaise: 18000,
    availableQuantity: 15,
    isMedicineViewOnly: true,
  },
];

export default function MerchantInventoryScreen() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [listings, setListings] = useState<MerchantListingItem[]>(SAMPLE_LISTINGS);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [stockModalOpen, setStockModalOpen] = useState(false);
  const [targetItem, setTargetItem] = useState<MerchantListingItem | null>(null);
  const [addQty, setAddQty] = useState('10');
  const [submitting, setSubmitting] = useState(false);

  const loadListings = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const data = await fetchMerchantListings('demo-outlet-1').catch(() => SAMPLE_LISTINGS);
      setListings(data.length > 0 ? data : SAMPLE_LISTINGS);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadListings();
  }, [loadListings]);

  const handleStockIn = async () => {
    if (!targetItem) return;
    const qty = parseInt(addQty, 10);
    if (isNaN(qty) || qty <= 0) {
      Alert.alert('Invalid Quantity', 'Please enter a valid positive number.');
      return;
    }

    setSubmitting(true);
    try {
      await receiveStock('demo-outlet-1', targetItem.id, qty, `recv-${Date.now()}`).catch(() => null);
      setListings((prev) =>
        prev.map((item) =>
          item.id === targetItem.id ? { ...item, availableQuantity: item.availableQuantity + qty } : item,
        ),
      );
      setStockModalOpen(false);
      Alert.alert('Stock Updated', `Added +${qty} units to ${targetItem.name}.`);
    } catch (err) {
      Alert.alert('Action Failed', err instanceof Error ? err.message : 'Please retry.');
    } finally {
      setSubmitting(false);
    }
  };

  const lowStockCount = listings.filter((i) => i.availableQuantity > 0 && i.availableQuantity <= 5).length;
  const outOfStockCount = listings.filter((i) => i.availableQuantity === 0).length;

  const filteredListings = listings.filter((item) => {
    const matchesSearch =
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.barcode.includes(searchQuery) ||
      (item.sku && item.sku.toLowerCase().includes(searchQuery.toLowerCase()));

    if (!matchesSearch) return false;
    if (selectedCategory === 'ALL') return true;
    if (selectedCategory === 'LOW_STOCK') return item.availableQuantity <= 5;
    if (selectedCategory === 'MEDICINE') return item.isMedicineViewOnly;
    return item.category === selectedCategory;
  });

  return (
    <ScreenShell header={<MerchantHeader title="Inventory & Stock Ledger" />}>
      {/* Search & Scan Action Bar */}
      <View style={styles.searchBarContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search by name, SKU, GTIN barcode..."
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      {/* Stock Health Overview Banner */}
      <View style={styles.healthBanner}>
        <View style={styles.healthCard}>
          <Text style={styles.healthLabel}>TOTAL LISTINGS</Text>
          <Text style={styles.healthValue}>{listings.length}</Text>
        </View>
        <View style={[styles.healthCard, styles.healthCardWarning]}>
          <Text style={[styles.healthLabel, styles.textWarning]}>LOW STOCK</Text>
          <Text style={[styles.healthValue, styles.textWarning]}>{lowStockCount}</Text>
        </View>
        <View style={[styles.healthCard, styles.healthCardCritical]}>
          <Text style={[styles.healthLabel, styles.textCritical]}>OUT OF STOCK</Text>
          <Text style={[styles.healthValue, styles.textCritical]}>{outOfStockCount}</Text>
        </View>
      </View>

      {/* Category Filter Chips */}
      <View style={styles.chipsRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsScroll}>
          {[
            { key: 'ALL', label: `All (${listings.length})` },
            { key: 'LOW_STOCK', label: `Low Stock (${lowStockCount + outOfStockCount})` },
            { key: 'Dog Food', label: 'Dog Food' },
            { key: 'Treats', label: 'Treats' },
            { key: 'Grooming & Hygiene', label: 'Grooming' },
            { key: 'MEDICINE', label: 'Medicines (View Only)' },
          ].map((chip) => {
            const isSelected = selectedCategory === chip.key;
            return (
              <Pressable
                key={chip.key}
                style={[styles.chip, isSelected && styles.chipActive]}
                onPress={() => setSelectedCategory(chip.key)}
              >
                <Text style={[styles.chipText, isSelected && styles.chipTextActive]}>{chip.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadListings(true)} />}
      >
        {loading ? (
          <ActivityIndicator style={styles.loader} color={palette.royalBlue} />
        ) : filteredListings.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>No inventory products found.</Text>
          </View>
        ) : (
          filteredListings.map((item) => {
            const isOut = item.availableQuantity === 0;
            const isLow = item.availableQuantity > 0 && item.availableQuantity <= 5;
            return (
              <View key={item.id} style={styles.productCard}>
                <View style={styles.productHeader}>
                  <View style={styles.productInfo}>
                    <Text style={styles.productName}>{item.name}</Text>
                    <Text style={styles.productCode}>
                      Barcode: {item.barcode} {item.sku ? `· SKU: ${item.sku}` : ''}
                    </Text>
                  </View>
                  <StatusBadge
                    status={
                      item.isMedicineViewOnly
                        ? 'VIEW_ONLY_MEDICINE'
                        : isOut
                          ? 'OUT_OF_STOCK'
                          : isLow
                            ? 'LOW_STOCK'
                            : 'IN_STOCK'
                    }
                    label={
                      item.isMedicineViewOnly
                        ? 'VIEW ONLY MEDICINE'
                        : isOut
                          ? '0 UNITS (OUT)'
                          : `${item.availableQuantity} UNITS`
                    }
                  />
                </View>

                <View style={styles.priceStockRow}>
                  <View>
                    <Text style={styles.sellingPrice}>₹{(item.sellingPricePaise / 100).toFixed(0)}</Text>
                    {item.mrpPaise > item.sellingPricePaise ? (
                      <Text style={styles.mrpPrice}>MRP ₹{(item.mrpPaise / 100).toFixed(0)}</Text>
                    ) : null}
                  </View>

                  <View style={styles.cardActions}>
                    <Pressable
                      style={styles.stockInBtn}
                      onPress={() => {
                        setTargetItem(item);
                        setAddQty('10');
                        setStockModalOpen(true);
                      }}
                      accessibilityRole="button"
                    >
                      <Text style={styles.stockInText}>Quick Stock In (+)</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      {/* Quick Stock In Modal */}
      <Modal visible={stockModalOpen} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Receive Stock Movement</Text>
            <Text style={styles.modalSub}>{targetItem?.name}</Text>
            <Text style={styles.modalBarcode}>Current Stock: {targetItem?.availableQuantity} units</Text>

            <TextInput
              style={styles.modalInput}
              placeholder="Quantity to add (e.g. 10)"
              value={addQty}
              onChangeText={setAddQty}
              keyboardType="number-pad"
              autoFocus
            />

            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancelBtn} onPress={() => setStockModalOpen(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.modalSubmitBtn, submitting && styles.disabledBtn]}
                disabled={submitting}
                onPress={handleStockIn}
              >
                <Text style={styles.modalSubmitText}>{submitting ? 'Recording…' : 'Record Receipt (+)'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  searchBarContainer: {
    paddingHorizontal: spacing.x4,
    paddingVertical: spacing.x2,
    backgroundColor: palette.white,
  },
  searchInput: {
    minHeight: 44,
    backgroundColor: palette.coolWhite,
    borderRadius: radii.compact,
    borderWidth: 1,
    borderColor: palette.outlineSoft,
    paddingHorizontal: spacing.x3,
    ...typography.body,
  },
  healthBanner: {
    flexDirection: 'row',
    backgroundColor: palette.white,
    paddingHorizontal: spacing.x4,
    paddingBottom: spacing.x3,
    gap: spacing.x2,
  },
  healthCard: {
    flex: 1,
    backgroundColor: palette.coolWhite,
    padding: spacing.x2,
    borderRadius: radii.compact,
    borderWidth: 1,
    borderColor: palette.outlineSoft,
    alignItems: 'center',
  },
  healthCardWarning: { backgroundColor: palette.amberSoft, borderColor: palette.amber },
  healthCardCritical: { backgroundColor: palette.errorSoft, borderColor: palette.error },
  healthLabel: { ...typography.caption, fontSize: 9, color: palette.inkMuted },
  healthValue: { ...typography.title, fontSize: 18, color: palette.ink },
  textWarning: { color: '#92400E' },
  textCritical: { color: palette.error },
  chipsRow: {
    backgroundColor: palette.white,
    borderBottomWidth: 1,
    borderBottomColor: palette.outlineSoft,
    paddingVertical: spacing.x2,
  },
  chipsScroll: { paddingHorizontal: spacing.x4, gap: spacing.x2 },
  chip: {
    paddingHorizontal: spacing.x3,
    paddingVertical: spacing.x1,
    borderRadius: radii.pill,
    backgroundColor: palette.coolWhite,
    borderWidth: 1,
    borderColor: palette.outlineSoft,
  },
  chipActive: { backgroundColor: palette.royalBlue, borderColor: palette.royalBlue },
  chipText: { ...typography.label, color: palette.ink },
  chipTextActive: { color: palette.white, fontWeight: '700' },
  scroll: { flex: 1 },
  content: { padding: spacing.x4, gap: spacing.x3, paddingBottom: spacing.x8 },
  productCard: {
    backgroundColor: palette.white,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: palette.outlineSoft,
    padding: spacing.x4,
    gap: spacing.x3,
  },
  productHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  productInfo: { flex: 1, paddingRight: spacing.x2 },
  productName: { ...typography.title, fontSize: 16, color: palette.ink },
  productCode: { ...typography.caption, color: palette.inkMuted, marginTop: 2 },
  priceStockRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: palette.outlineSoft,
    paddingTop: spacing.x2,
  },
  sellingPrice: { ...typography.title, color: palette.royalBlue },
  mrpPrice: { ...typography.caption, textDecorationLine: 'line-through', color: palette.inkMuted },
  cardActions: { flexDirection: 'row', gap: spacing.x2 },
  stockInBtn: {
    minHeight: touchTarget,
    paddingHorizontal: spacing.x4,
    borderRadius: radii.compact,
    backgroundColor: palette.royalBlue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stockInText: { ...typography.label, color: palette.white, fontWeight: '700' },
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
  modalBarcode: { ...typography.caption, color: palette.royalBlue, fontWeight: '700' },
  modalInput: {
    minHeight: touchTarget,
    borderWidth: 1,
    borderColor: palette.outlineSoft,
    borderRadius: radii.compact,
    paddingHorizontal: spacing.x3,
    ...typography.body,
  },
  modalActions: { flexDirection: 'row', gap: spacing.x3, marginTop: spacing.x2 },
  modalCancelBtn: { flex: 1, minHeight: touchTarget, alignItems: 'center', justifyContent: 'center' },
  modalCancelText: { ...typography.label, color: palette.inkMuted },
  modalSubmitBtn: {
    flex: 1.5,
    minHeight: touchTarget,
    backgroundColor: palette.royalBlue,
    borderRadius: radii.compact,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalSubmitText: { ...typography.label, color: palette.white, fontWeight: '700' },
  disabledBtn: { opacity: 0.5 },
});
