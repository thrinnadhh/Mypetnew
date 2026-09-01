import React, { useState } from 'react';
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
  type InventoryAdjustmentReason,
  type InventoryBalance,
  type InventoryCountSession,
} from '../../inventory/api';
import { colors, radius, spacing, typography } from '../tokens';
import { PrimaryButton } from './PrimaryButton';
import { SecondaryButton } from './SecondaryButton';

export type StockOperationMode =
  | 'ADJUSTMENT'
  | 'RECEIVING'
  | 'DAMAGE'
  | 'EXPIRY'
  | 'SHRINKAGE'
  | 'RETURN'
  | 'TRANSFER'
  | 'COUNT';

export interface StockAdjustmentModalProps {
  visible: boolean;
  listingId: string;
  listingName: string;
  currentBalance?: InventoryBalance;
  initialMode?: StockOperationMode;
  onClose: () => void;
  onManualAdjustment: (units: number, isDecrease: boolean, reason: InventoryAdjustmentReason) => Promise<void>;
  onReceiving: (units: number, refType?: string, refId?: string, batchNo?: string, expiryDate?: string) => Promise<void>;
  onDamage: (units: number, details?: string, refId?: string) => Promise<void>;
  onExpiry: (units: number, batchNo?: string, expiryDate?: string) => Promise<void>;
  onShrinkage: (units: number, notes?: string, refId?: string) => Promise<void>;
  onReturn: (units: number, returnType: 'CUSTOMER_RETURN' | 'VENDOR_RETURN', refId?: string) => Promise<void>;
  onTransfer: (units: number, destinationOutletId: string) => Promise<void>;
  onStartCount?: () => Promise<InventoryCountSession>;
  onAddCountLine?: (sessionId: string, qty: number) => Promise<void>;
  onSubmitCount?: (sessionId: string) => Promise<void>;
  countSession?: InventoryCountSession;
  testID?: string;
}

export function StockAdjustmentModal({
  visible,
  listingId,
  listingName,
  currentBalance,
  initialMode = 'ADJUSTMENT',
  onClose,
  onManualAdjustment,
  onReceiving,
  onDamage,
  onExpiry,
  onShrinkage,
  onReturn,
  onTransfer,
  onStartCount,
  onAddCountLine,
  onSubmitCount,
  countSession,
  testID,
}: StockAdjustmentModalProps) {
  const [opMode, setOpMode] = useState<StockOperationMode>(initialMode);
  const [units, setUnits] = useState('1');
  const [isDecrease, setIsDecrease] = useState(false);
  const [refType, setRefType] = useState('');
  const [refId, setRefId] = useState('');
  const [batchNo, setBatchNo] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [destOutletId, setDestOutletId] = useState('');
  const [returnType, setReturnType] = useState<'CUSTOMER_RETURN' | 'VENDOR_RETURN'>('CUSTOMER_RETURN');
  const [countedQty, setCountedQty] = useState('0');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const currentOnHand = currentBalance?.onHand ?? 0;
  const parsedUnits = parseInt(units, 10);
  const validUnits = Number.isSafeInteger(parsedUnits) && parsedUnits > 0;
  const resultingOnHand = validUnits
    ? isDecrease
      ? currentOnHand - parsedUnits
      : currentOnHand + parsedUnits
    : currentOnHand;

  function resetForm() {
    setUnits('1');
    setIsDecrease(false);
    setRefType('');
    setRefId('');
    setBatchNo('');
    setExpiryDate('');
    setDestOutletId('');
    setCountedQty('0');
    setErrorMessage('');
    setLoading(false);
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  async function handleSubmit() {
    if (!validUnits && opMode !== 'COUNT') {
      setErrorMessage('Please enter a valid positive integer quantity.');
      return;
    }
    setErrorMessage('');
    setLoading(true);
    try {
      if (opMode === 'ADJUSTMENT') {
        const reason: InventoryAdjustmentReason = isDecrease ? 'MANUAL_DECREASE' : 'MANUAL_INCREASE';
        await onManualAdjustment(parsedUnits, isDecrease, reason);
      } else if (opMode === 'RECEIVING') {
        await onReceiving(parsedUnits, refType || undefined, refId || undefined, batchNo || undefined, expiryDate || undefined);
      } else if (opMode === 'DAMAGE') {
        await onDamage(parsedUnits, refType || undefined, refId || undefined);
      } else if (opMode === 'EXPIRY') {
        await onExpiry(parsedUnits, batchNo || undefined, expiryDate || undefined);
      } else if (opMode === 'SHRINKAGE') {
        await onShrinkage(parsedUnits, refType || undefined, refId || undefined);
      } else if (opMode === 'RETURN') {
        await onReturn(parsedUnits, returnType, refId || undefined);
      } else if (opMode === 'TRANSFER') {
        if (!destOutletId.trim()) {
          setErrorMessage('Destination outlet ID is required.');
          setLoading(false);
          return;
        }
        await onTransfer(parsedUnits, destOutletId.trim());
      }
      handleClose();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Operation failed.');
    } finally {
      setLoading(false);
    }
  }

  function adjustStepper(delta: number) {
    const current = parseInt(units, 10) || 0;
    const next = Math.max(1, current + delta);
    setUnits(String(next));
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
      testID={testID}
    >
      <Pressable style={styles.backdrop} onPress={handleClose}>
        <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.titleGroup}>
              <Text style={styles.title}>Inventory Operations</Text>
              <Text style={styles.subtitle} numberOfLines={1}>
                {listingName} (On Hand: {currentOnHand})
              </Text>
            </View>
            <Pressable
              onPress={handleClose}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel="Close stock adjustment"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>

          {/* Operation Mode Tabs */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.modeTabs}
          >
            {(
              [
                { mode: 'ADJUSTMENT', label: 'Manual' },
                { mode: 'RECEIVING', label: 'Receive' },
                { mode: 'DAMAGE', label: 'Damage' },
                { mode: 'EXPIRY', label: 'Expiry' },
                { mode: 'SHRINKAGE', label: 'Shrinkage' },
                { mode: 'RETURN', label: 'Return' },
                { mode: 'TRANSFER', label: 'Transfer' },
                { mode: 'COUNT', label: 'Count' },
              ] as const
            ).map((tab) => {
              const isSelected = opMode === tab.mode;
              return (
                <Pressable
                  key={tab.mode}
                  onPress={() => {
                    setOpMode(tab.mode);
                    setErrorMessage('');
                  }}
                  style={[
                    styles.tabChip,
                    isSelected ? styles.tabChipSelected : styles.tabChipUnselected,
                  ]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: isSelected }}
                >
                  <Text
                    style={[
                      styles.tabText,
                      isSelected ? styles.tabTextSelected : styles.tabTextUnselected,
                    ]}
                  >
                    {tab.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <ScrollView style={styles.formBody} contentContainerStyle={styles.formContent}>
            {errorMessage ? (
              <View style={styles.errorBanner}>
                <Text accessibilityRole="alert" style={styles.errorText}>
                  {errorMessage}
                </Text>
              </View>
            ) : null}

            {/* Mode-Specific Forms */}
            {opMode === 'ADJUSTMENT' && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Manual Stock Correction</Text>

                <View style={styles.toggleRow}>
                  <Pressable
                    onPress={() => setIsDecrease(false)}
                    style={[
                      styles.directionBtn,
                      !isDecrease && styles.directionBtnActiveAdd,
                    ]}
                    accessibilityRole="button"
                  >
                    <Text
                      style={[
                        styles.directionBtnText,
                        !isDecrease && styles.directionBtnTextActive,
                      ]}
                    >
                      + Increase Stock
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={() => setIsDecrease(true)}
                    style={[
                      styles.directionBtn,
                      isDecrease && styles.directionBtnActiveSubtract,
                    ]}
                    accessibilityRole="button"
                  >
                    <Text
                      style={[
                        styles.directionBtnText,
                        isDecrease && styles.directionBtnTextActive,
                      ]}
                    >
                      - Decrease Stock
                    </Text>
                  </Pressable>
                </View>

                {/* Quantity Stepper */}
                <View style={styles.stepperContainer}>
                  <Text style={styles.inputLabel}>Adjustment Units</Text>
                  <View style={styles.stepperRow}>
                    <Pressable
                      onPress={() => adjustStepper(-5)}
                      style={styles.stepperBtn}
                      accessibilityRole="button"
                      accessibilityLabel="Decrease by 5"
                    >
                      <Text style={styles.stepperBtnText}>-5</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => adjustStepper(-1)}
                      style={styles.stepperBtn}
                      accessibilityRole="button"
                      accessibilityLabel="Decrease by 1"
                    >
                      <Text style={styles.stepperBtnText}>-1</Text>
                    </Pressable>

                    <TextInput
                      value={units}
                      onChangeText={setUnits}
                      keyboardType="number-pad"
                      style={styles.stepperInput}
                      accessibilityLabel="Units to adjust"
                    />

                    <Pressable
                      onPress={() => adjustStepper(1)}
                      style={styles.stepperBtn}
                      accessibilityRole="button"
                      accessibilityLabel="Increase by 1"
                    >
                      <Text style={styles.stepperBtnText}>+1</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => adjustStepper(5)}
                      style={styles.stepperBtn}
                      accessibilityRole="button"
                      accessibilityLabel="Increase by 5"
                    >
                      <Text style={styles.stepperBtnText}>+5</Text>
                    </Pressable>
                  </View>
                </View>

                {/* Live Preview */}
                <View style={styles.previewBox}>
                  <Text style={styles.previewLabel}>Projected On Hand:</Text>
                  <Text
                    style={[
                      styles.previewValue,
                      resultingOnHand < 0 && styles.negativePreview,
                    ]}
                  >
                    {currentOnHand} {isDecrease ? '-' : '+'} {validUnits ? parsedUnits : 0} = {resultingOnHand}
                  </Text>
                </View>
              </View>
            )}

            {opMode === 'RECEIVING' && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Record Stock Receiving</Text>
                <Text style={styles.inputLabel}>Units Received *</Text>
                <TextInput
                  value={units}
                  onChangeText={setUnits}
                  keyboardType="number-pad"
                  placeholder="e.g. 24"
                  style={styles.input}
                />
                <Text style={styles.inputLabel}>Reference Type (e.g. PO, Invoice)</Text>
                <TextInput
                  value={refType}
                  onChangeText={setRefType}
                  placeholder="PO / ASN / Vendor"
                  style={styles.input}
                />
                <Text style={styles.inputLabel}>Reference / Invoice ID</Text>
                <TextInput
                  value={refId}
                  onChangeText={setRefId}
                  placeholder="e.g. INV-2026-0901"
                  style={styles.input}
                />
                <Text style={styles.inputLabel}>Batch / Lot Number</Text>
                <TextInput
                  value={batchNo}
                  onChangeText={setBatchNo}
                  placeholder="Optional batch code"
                  style={styles.input}
                />
                <Text style={styles.inputLabel}>Expiry Date (YYYY-MM-DD)</Text>
                <TextInput
                  value={expiryDate}
                  onChangeText={setExpiryDate}
                  placeholder="e.g. 2027-12-31"
                  style={styles.input}
                />
              </View>
            )}

            {opMode === 'DAMAGE' && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Damaged Stock Write-off</Text>
                <Text style={styles.inputLabel}>Units Damaged *</Text>
                <TextInput
                  value={units}
                  onChangeText={setUnits}
                  keyboardType="number-pad"
                  placeholder="Units to remove"
                  style={styles.input}
                />
                <Text style={styles.inputLabel}>Damage Reason / Details</Text>
                <TextInput
                  value={refType}
                  onChangeText={setRefType}
                  placeholder="e.g. Torn packaging, water leak"
                  style={styles.input}
                />
                <Text style={styles.inputLabel}>Inspection Reference ID</Text>
                <TextInput
                  value={refId}
                  onChangeText={setRefId}
                  placeholder="Optional reference"
                  style={styles.input}
                />
              </View>
            )}

            {opMode === 'EXPIRY' && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Record Expired Stock</Text>
                <Text style={styles.inputLabel}>Units Expired *</Text>
                <TextInput
                  value={units}
                  onChangeText={setUnits}
                  keyboardType="number-pad"
                  placeholder="Units expired"
                  style={styles.input}
                />
                <Text style={styles.inputLabel}>Batch Reference</Text>
                <TextInput
                  value={batchNo}
                  onChangeText={setBatchNo}
                  placeholder="e.g. LOT-883"
                  style={styles.input}
                />
                <Text style={styles.inputLabel}>Recorded Expiry Date</Text>
                <TextInput
                  value={expiryDate}
                  onChangeText={setExpiryDate}
                  placeholder="YYYY-MM-DD"
                  style={styles.input}
                />
              </View>
            )}

            {opMode === 'SHRINKAGE' && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Stock Shrinkage / Discrepancy</Text>
                <Text style={styles.inputLabel}>Units Missing *</Text>
                <TextInput
                  value={units}
                  onChangeText={setUnits}
                  keyboardType="number-pad"
                  placeholder="Units missing"
                  style={styles.input}
                />
                <Text style={styles.inputLabel}>Audit Notes</Text>
                <TextInput
                  value={refType}
                  onChangeText={setRefType}
                  placeholder="Notes from store audit"
                  style={styles.input}
                />
              </View>
            )}

            {opMode === 'RETURN' && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Stock Return</Text>
                <View style={styles.toggleRow}>
                  <Pressable
                    onPress={() => setReturnType('CUSTOMER_RETURN')}
                    style={[
                      styles.directionBtn,
                      returnType === 'CUSTOMER_RETURN' && styles.directionBtnActiveAdd,
                    ]}
                    accessibilityRole="button"
                  >
                    <Text
                      style={[
                        styles.directionBtnText,
                        returnType === 'CUSTOMER_RETURN' && styles.directionBtnTextActive,
                      ]}
                    >
                      Customer Return (+)
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={() => setReturnType('VENDOR_RETURN')}
                    style={[
                      styles.directionBtn,
                      returnType === 'VENDOR_RETURN' && styles.directionBtnActiveSubtract,
                    ]}
                    accessibilityRole="button"
                  >
                    <Text
                      style={[
                        styles.directionBtnText,
                        returnType === 'VENDOR_RETURN' && styles.directionBtnTextActive,
                      ]}
                    >
                      Vendor Return (-)
                    </Text>
                  </Pressable>
                </View>

                <Text style={styles.inputLabel}>Units Returned *</Text>
                <TextInput
                  value={units}
                  onChangeText={setUnits}
                  keyboardType="number-pad"
                  placeholder="Units"
                  style={styles.input}
                />
                <Text style={styles.inputLabel}>Return Authorization / Ref ID</Text>
                <TextInput
                  value={refId}
                  onChangeText={setRefId}
                  placeholder="e.g. RMA-9921"
                  style={styles.input}
                />
              </View>
            )}

            {opMode === 'TRANSFER' && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Inter-Outlet Transfer</Text>
                <Text style={styles.inputLabel}>Units to Transfer *</Text>
                <TextInput
                  value={units}
                  onChangeText={setUnits}
                  keyboardType="number-pad"
                  placeholder="Units to transfer"
                  style={styles.input}
                />
                <Text style={styles.inputLabel}>Destination Outlet UUID *</Text>
                <TextInput
                  value={destOutletId}
                  onChangeText={setDestOutletId}
                  placeholder="Destination outlet ID"
                  style={styles.input}
                />
              </View>
            )}

            {opMode === 'COUNT' && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Physical Stock Count</Text>
                {!countSession ? (
                  <View style={styles.countStartBox}>
                    <Text style={styles.countDesc}>
                      Start a count session for this outlet to reconcile actual shelf count against ledger.
                    </Text>
                    {onStartCount ? (
                      <PrimaryButton
                        title="Start Count Session"
                        onPress={async () => {
                          setLoading(true);
                          try {
                            await onStartCount();
                          } catch (err) {
                            setErrorMessage(err instanceof Error ? err.message : 'Could not start count.');
                          } finally {
                            setLoading(false);
                          }
                        }}
                        loading={loading}
                      />
                    ) : null}
                  </View>
                ) : (
                  <View style={styles.countSessionBox}>
                    <Text style={styles.sessionMeta}>
                      Session ID: {countSession.id.slice(0, 8)}… ({countSession.status})
                    </Text>
                    <Text style={styles.inputLabel}>Physical Count for {listingName}</Text>
                    <TextInput
                      value={countedQty}
                      onChangeText={setCountedQty}
                      keyboardType="number-pad"
                      placeholder="Counted quantity"
                      style={styles.input}
                    />

                    {onAddCountLine ? (
                      <SecondaryButton
                        title="Save Count Line"
                        onPress={async () => {
                          const qty = parseInt(countedQty, 10);
                          if (!Number.isSafeInteger(qty) || qty < 0) {
                            setErrorMessage('Enter a non-negative counted quantity.');
                            return;
                          }
                          setLoading(true);
                          try {
                            await onAddCountLine(countSession.id, qty);
                          } catch (err) {
                            setErrorMessage(err instanceof Error ? err.message : 'Could not save count line.');
                          } finally {
                            setLoading(false);
                          }
                        }}
                        disabled={loading || countSession.status !== 'OPEN'}
                      />
                    ) : null}

                    {onSubmitCount ? (
                      <PrimaryButton
                        title="Submit & Reconcile Count"
                        onPress={async () => {
                          setLoading(true);
                          try {
                            await onSubmitCount(countSession.id);
                            handleClose();
                          } catch (err) {
                            setErrorMessage(err instanceof Error ? err.message : 'Count submission failed.');
                          } finally {
                            setLoading(false);
                          }
                        }}
                        loading={loading}
                        disabled={loading || countSession.status !== 'OPEN'}
                      />
                    ) : null}
                  </View>
                )}
              </View>
            )}
          </ScrollView>

          {/* Action Footer */}
          {opMode !== 'COUNT' ? (
            <View style={styles.footer}>
              <SecondaryButton
                title="Cancel"
                onPress={handleClose}
                disabled={loading}
                style={styles.footerBtn}
              />
              <PrimaryButton
                title="Commit Movement"
                onPress={() => void handleSubmit()}
                loading={loading}
                disabled={loading}
                variant={isDecrease || opMode === 'DAMAGE' || opMode === 'EXPIRY' ? 'destructive' : 'primary'}
                style={styles.footerBtn}
              />
            </View>
          ) : null}
        </Pressable>
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
    maxHeight: '90%',
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
    color: colors.slate600,
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
  modeTabs: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
    backgroundColor: colors.surfaceDim,
  },
  tabChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    borderWidth: 1,
    minHeight: 36,
    justifyContent: 'center',
  },
  tabChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  tabChipUnselected: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  tabText: {
    ...typography.labelSm,
  },
  tabTextSelected: {
    color: colors.onPrimary,
    fontWeight: '700',
  },
  tabTextUnselected: {
    color: colors.slate700,
  },
  formBody: {
    flexGrow: 0,
  },
  formContent: {
    padding: spacing.lg,
    gap: spacing.md,
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
    gap: spacing.sm,
  },
  sectionTitle: {
    ...typography.labelLg,
    color: colors.slate900,
  },
  toggleRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  directionBtn: {
    flex: 1,
    minHeight: spacing.touchTargetMin,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  directionBtnActiveAdd: {
    backgroundColor: colors.successContainer,
    borderColor: colors.success,
  },
  directionBtnActiveSubtract: {
    backgroundColor: colors.errorContainer,
    borderColor: colors.error,
  },
  directionBtnText: {
    ...typography.labelMd,
    color: colors.slate700,
  },
  directionBtnTextActive: {
    fontWeight: '800',
    color: colors.slate900,
  },
  stepperContainer: {
    gap: spacing.xs,
  },
  inputLabel: {
    ...typography.labelSm,
    color: colors.slate700,
    fontWeight: '700',
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  stepperBtn: {
    minWidth: 44,
    minHeight: spacing.touchTargetMin,
    backgroundColor: colors.slate100,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  stepperBtnText: {
    ...typography.labelMd,
    color: colors.slate800,
    fontWeight: '700',
  },
  stepperInput: {
    flex: 1,
    minHeight: spacing.touchTargetMin,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    textAlign: 'center',
    ...typography.headlineSm,
    color: colors.slate900,
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
  previewBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    backgroundColor: colors.surfaceDim,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  previewLabel: {
    ...typography.bodyMd,
    color: colors.slate700,
  },
  previewValue: {
    ...typography.labelLg,
    color: colors.primary,
    fontWeight: '800',
  },
  negativePreview: {
    color: colors.error,
  },
  countStartBox: {
    gap: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surfaceDim,
    borderRadius: radius.md,
  },
  countDesc: {
    ...typography.bodyMd,
    color: colors.slate600,
  },
  countSessionBox: {
    gap: spacing.md,
  },
  sessionMeta: {
    ...typography.codeSm,
    color: colors.slate700,
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
