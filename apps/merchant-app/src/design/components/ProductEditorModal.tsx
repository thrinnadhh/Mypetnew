import React, { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  type BarcodeType,
  type CreateListingInput,
  type ListingKind,
  type MerchantListing,
  type UpdateListingInput,
} from '../../catalog/api';
import { colors, radius, spacing, typography } from '../tokens';
import { PrimaryButton } from './PrimaryButton';
import { SecondaryButton } from './SecondaryButton';

export interface ProductEditorModalProps {
  visible: boolean;
  editingListing?: MerchantListing | null;
  onClose: () => void;
  onSaveCreate: (input: CreateListingInput) => Promise<void>;
  onSaveUpdate: (listing: MerchantListing, input: UpdateListingInput) => Promise<void>;
  onScanBarcode?: () => void;
  loading?: boolean;
  testID?: string;
}

interface ProductEditorFormProps {
  editingListing?: MerchantListing | null;
  onClose: () => void;
  onSaveCreate: (input: CreateListingInput) => Promise<void>;
  onSaveUpdate: (listing: MerchantListing, input: UpdateListingInput) => Promise<void>;
  onScanBarcode?: () => void;
  loading?: boolean;
  testID?: string;
}

function ProductEditorForm({
  editingListing,
  onClose,
  onSaveCreate,
  onSaveUpdate,
  onScanBarcode,
  loading = false,
  testID,
}: ProductEditorFormProps) {
  const isEditing = Boolean(editingListing);

  const [name, setName] = useState(() => editingListing?.name ?? '');
  const [kind, setKind] = useState<ListingKind>(() => editingListing?.kind ?? 'PRODUCT');
  const [barcodeType, setBarcodeType] = useState<BarcodeType>(() => editingListing?.barcodeType ?? 'INTERNAL');
  const [barcode, setBarcode] = useState(() => editingListing?.normalizedBarcode ?? '');
  const [mrpRupees, setMrpRupees] = useState(() => editingListing ? String(editingListing.mrpPaise / 100) : '');
  const [sellingRupees, setSellingRupees] = useState(() => editingListing ? String(editingListing.sellingPricePaise / 100) : '');
  const [category, setCategory] = useState(() => editingListing?.category ?? 'other');
  const [brand, setBrand] = useState(() => editingListing?.brand ?? '');
  const [sku, setSku] = useState(() => editingListing?.sku ?? '');
  const [packLabel, setPackLabel] = useState(() => editingListing?.packLabel ?? '');
  const [petType, setPetType] = useState(() => editingListing?.petType ?? '');
  const [lifeStage, setLifeStage] = useState(() => editingListing?.lifeStage ?? '');
  const [description, setDescription] = useState(() => editingListing?.description ?? '');
  const [errorMessage, setErrorMessage] = useState('');

  const parsedMrpPaise = useMemo(() => {
    const num = parseFloat(mrpRupees);
    return isNaN(num) || num < 0 ? 0 : Math.round(num * 100);
  }, [mrpRupees]);

  const parsedSellingPaise = useMemo(() => {
    const num = parseFloat(sellingRupees);
    return isNaN(num) || num < 0 ? 0 : Math.round(num * 100);
  }, [sellingRupees]);

  const discountPercent = useMemo(() => {
    if (parsedMrpPaise <= 0 || parsedSellingPaise >= parsedMrpPaise) return 0;
    return Math.round(((parsedMrpPaise - parsedSellingPaise) / parsedMrpPaise) * 100);
  }, [parsedMrpPaise, parsedSellingPaise]);

  async function handleSave() {
    if (!name.trim()) {
      setErrorMessage('Product name is required.');
      return;
    }
    if (!category.trim()) {
      setErrorMessage('Category slug is required.');
      return;
    }
    if (parsedMrpPaise <= 0) {
      setErrorMessage('Enter a valid MRP greater than ₹0.');
      return;
    }
    if (parsedSellingPaise <= 0) {
      setErrorMessage('Enter a valid selling price greater than ₹0.');
      return;
    }
    if (parsedSellingPaise > parsedMrpPaise) {
      setErrorMessage('Selling price cannot exceed MRP.');
      return;
    }

    if (!isEditing && !barcode.trim()) {
      setErrorMessage('Barcode or internal SKU code is required.');
      return;
    }

    setErrorMessage('');
    try {
      if (isEditing && editingListing) {
        const updateInput: UpdateListingInput = {
          name: name.trim(),
          mrpPaise: parsedMrpPaise,
          sellingPricePaise: parsedSellingPaise,
          category: category.trim().toLowerCase(),
          brand: brand.trim() || null,
          sku: sku.trim() || null,
          packLabel: packLabel.trim() || null,
          petType: petType.trim() || null,
          lifeStage: lifeStage.trim() || null,
          description: description.trim() || null,
        };
        await onSaveUpdate(editingListing, updateInput);
      } else {
        const createInput: CreateListingInput = {
          name: name.trim(),
          kind,
          barcodeType,
          barcode: barcode.trim(),
          mrpPaise: parsedMrpPaise,
          sellingPricePaise: parsedSellingPaise,
          category: category.trim().toLowerCase(),
          brand: brand.trim() || null,
          sku: sku.trim() || null,
          packLabel: packLabel.trim() || null,
          petType: petType.trim() || null,
          lifeStage: lifeStage.trim() || null,
          description: description.trim() || null,
        };
        await onSaveCreate(createInput);
      }
      onClose();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not save product.');
    }
  }

  return (
    <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()} testID={testID}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.titleGroup}>
          <Text style={styles.title}>
            {isEditing ? 'Edit Product Listing' : 'Create New Product'}
          </Text>
          <Text style={styles.subtitle}>
            {isEditing
              ? `Editing: ${editingListing?.normalizedBarcode}`
              : 'Add product to current outlet catalog'}
          </Text>
        </View>
        <Pressable
          onPress={onClose}
          style={styles.closeBtn}
          accessibilityRole="button"
          accessibilityLabel="Close product editor"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
      </View>

      <ScrollView style={styles.formBody} contentContainerStyle={styles.formContent}>
        {errorMessage ? (
          <View style={styles.errorBanner}>
            <Text accessibilityRole="alert" style={styles.errorText}>
              {errorMessage}
            </Text>
          </View>
        ) : null}

        {/* Basic Info Section */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>1. Basic Information</Text>

          <Text style={styles.inputLabel}>Product Name *</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="e.g. Royal Canin Maxi Adult Dog Food"
            style={styles.input}
            accessibilityLabel="Product name"
          />

          {!isEditing ? (
            <>
              <Text style={styles.inputLabel}>Listing Kind *</Text>
              <View style={styles.choiceRow}>
                {(['PRODUCT', 'MEDICINE'] as ListingKind[]).map((value) => (
                  <Pressable
                    key={value}
                    onPress={() => setKind(value)}
                    style={[
                      styles.choiceChip,
                      kind === value && styles.choiceChipSelected,
                    ]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: kind === value }}
                  >
                    <Text
                      style={[
                        styles.choiceText,
                        kind === value && styles.choiceTextSelected,
                      ]}
                    >
                      {value === 'MEDICINE' ? '💊 Medicine (View-only)' : '🐾 Product'}
                    </Text>
                  </Pressable>
                ))}
              </View>
              {kind === 'MEDICINE' ? (
                <Text style={styles.policyNotice}>
                  Medicine listings are published view-only per regulatory safety rules.
                </Text>
              ) : null}

              <Text style={styles.inputLabel}>Barcode Type *</Text>
              <View style={styles.choiceRow}>
                {(['INTERNAL', 'GTIN_13', 'GTIN_8', 'GTIN_12'] as BarcodeType[]).map((type) => (
                  <Pressable
                    key={type}
                    onPress={() => setBarcodeType(type)}
                    style={[
                      styles.choiceChip,
                      barcodeType === type && styles.choiceChipSelected,
                    ]}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: barcodeType === type }}
                  >
                    <Text
                      style={[
                        styles.choiceText,
                        barcodeType === type && styles.choiceTextSelected,
                      ]}
                    >
                      {type}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.inputLabel}>Barcode Value *</Text>
              <View style={styles.barcodeInputRow}>
                <TextInput
                  value={barcode}
                  onChangeText={setBarcode}
                  placeholder={barcodeType === 'INTERNAL' ? 'e.g. INT-DOG-001' : '8901234567890'}
                  keyboardType={barcodeType === 'INTERNAL' ? 'default' : 'number-pad'}
                  autoCapitalize="none"
                  style={[styles.input, styles.flexInput]}
                  accessibilityLabel="Barcode value"
                />
                {onScanBarcode ? (
                  <SecondaryButton
                    title="📷 Scan"
                    onPress={onScanBarcode}
                    style={styles.scanBtn}
                  />
                ) : null}
              </View>
            </>
          ) : null}

          <Text style={styles.inputLabel}>Category Slug *</Text>
          <TextInput
            value={category}
            onChangeText={setCategory}
            placeholder="e.g. dog-food, toys, grooming"
            autoCapitalize="none"
            style={styles.input}
            accessibilityLabel="Category slug"
          />
        </View>

        {/* Pricing Section */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>2. Pricing & Margin</Text>

          <View style={styles.dualInputRow}>
            <View style={styles.dualInputCol}>
              <Text style={styles.inputLabel}>MRP (₹) *</Text>
              <TextInput
                value={mrpRupees}
                onChangeText={setMrpRupees}
                placeholder="e.g. 1500.00"
                keyboardType="decimal-pad"
                style={styles.input}
                accessibilityLabel="MRP in rupees"
              />
            </View>

            <View style={styles.dualInputCol}>
              <Text style={styles.inputLabel}>Selling Price (₹) *</Text>
              <TextInput
                value={sellingRupees}
                onChangeText={setSellingRupees}
                placeholder="e.g. 1350.00"
                keyboardType="decimal-pad"
                style={styles.input}
                accessibilityLabel="Selling price in rupees"
              />
            </View>
          </View>

          {parsedMrpPaise > 0 && parsedSellingPaise > 0 ? (
            <View style={styles.marginPreview}>
              <Text style={styles.marginText}>
                Discount to Customer: {discountPercent}% (Save ₹{((parsedMrpPaise - parsedSellingPaise) / 100).toFixed(2)})
              </Text>
            </View>
          ) : null}
        </View>

        {/* Attributes Section */}
        <View style={styles.section}>
          <Text style={styles.sectionHeader}>3. Product Attributes (Optional)</Text>

          <View style={styles.dualInputRow}>
            <View style={styles.dualInputCol}>
              <Text style={styles.inputLabel}>Brand</Text>
              <TextInput
                value={brand}
                onChangeText={setBrand}
                placeholder="e.g. Royal Canin"
                style={styles.input}
              />
            </View>
            <View style={styles.dualInputCol}>
              <Text style={styles.inputLabel}>Store SKU</Text>
              <TextInput
                value={sku}
                onChangeText={setSku}
                placeholder="e.g. RC-MXI-15"
                style={styles.input}
              />
            </View>
          </View>

          <View style={styles.dualInputRow}>
            <View style={styles.dualInputCol}>
              <Text style={styles.inputLabel}>Pack Label / Size</Text>
              <TextInput
                value={packLabel}
                onChangeText={setPackLabel}
                placeholder="e.g. 15kg Bag"
                style={styles.input}
              />
            </View>
            <View style={styles.dualInputCol}>
              <Text style={styles.inputLabel}>Pet Type</Text>
              <TextInput
                value={petType}
                onChangeText={setPetType}
                placeholder="e.g. Dog, Cat"
                style={styles.input}
              />
            </View>
          </View>

          <Text style={styles.inputLabel}>Life Stage</Text>
          <TextInput
            value={lifeStage}
            onChangeText={setLifeStage}
            placeholder="e.g. Puppy, Adult, Senior"
            style={styles.input}
          />

          <Text style={styles.inputLabel}>Description</Text>
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="Product description and highlights…"
            multiline
            style={[styles.input, styles.multilineInput]}
          />
        </View>
      </ScrollView>

      {/* Action Footer */}
      <View style={styles.footer}>
        <SecondaryButton
          title="Cancel"
          onPress={onClose}
          disabled={loading}
          style={styles.footerBtn}
        />
        <PrimaryButton
          title={isEditing ? 'Save Changes' : 'Create Product'}
          onPress={() => void handleSave()}
          loading={loading}
          disabled={loading}
          style={styles.footerBtn}
        />
      </View>
    </Pressable>
  );
}

export function ProductEditorModal({
  visible,
  editingListing,
  onClose,
  onSaveCreate,
  onSaveUpdate,
  onScanBarcode,
  loading = false,
  testID,
}: ProductEditorModalProps) {
  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      testID={testID}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <ProductEditorForm
          key={editingListing ? editingListing.id : 'create'}
          editingListing={editingListing}
          onClose={onClose}
          onSaveCreate={onSaveCreate}
          onSaveUpdate={onSaveUpdate}
          onScanBarcode={onScanBarcode}
          loading={loading}
          testID={testID}
        />
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    maxHeight: '92%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    backgroundColor: colors.slate50,
  },
  titleGroup: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...typography.headlineSm,
    color: colors.slate900,
  },
  subtitle: {
    ...typography.bodySm,
    color: colors.slate500,
  },
  closeBtn: {
    width: spacing.touchTargetMin,
    height: spacing.touchTargetMin,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
  },
  closeText: {
    fontSize: 18,
    color: colors.slate600,
    fontWeight: '700',
  },
  formBody: {
    flexGrow: 0,
  },
  formContent: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  errorBanner: {
    backgroundColor: colors.errorContainer,
    padding: spacing.sm,
    borderRadius: radius.md,
  },
  errorText: {
    ...typography.bodySm,
    color: colors.onErrorContainer,
    fontWeight: '600',
  },
  section: {
    gap: spacing.xs,
  },
  sectionHeader: {
    ...typography.labelLg,
    color: colors.slate900,
    marginBottom: spacing.xs,
  },
  inputLabel: {
    ...typography.labelSm,
    color: colors.slate700,
    fontWeight: '700',
    marginTop: spacing.xs,
  },
  input: {
    minHeight: spacing.touchTargetMin,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    ...typography.bodyMd,
    color: colors.onSurface,
  },
  multilineInput: {
    minHeight: 80,
    textAlignVertical: 'top',
    paddingVertical: spacing.sm,
  },
  choiceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  choiceChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    minHeight: 36,
    justifyContent: 'center',
  },
  choiceChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  choiceText: {
    ...typography.labelSm,
    color: colors.slate700,
  },
  choiceTextSelected: {
    color: colors.onPrimary,
    fontWeight: '700',
  },
  policyNotice: {
    ...typography.bodySm,
    fontSize: 12,
    color: colors.warning,
    fontWeight: '600',
  },
  barcodeInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  flexInput: {
    flex: 1,
  },
  scanBtn: {
    minHeight: spacing.touchTargetMin,
    paddingHorizontal: spacing.md,
  },
  dualInputRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  dualInputCol: {
    flex: 1,
  },
  marginPreview: {
    backgroundColor: colors.successContainer,
    padding: spacing.sm,
    borderRadius: radius.md,
    marginTop: spacing.xs,
  },
  marginText: {
    ...typography.bodySm,
    color: colors.onSuccessContainer,
    fontWeight: '700',
  },
  footer: {
    flexDirection: 'row',
    padding: spacing.md,
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    backgroundColor: colors.slate50,
  },
  footerBtn: {
    flex: 1,
  },
});
