import React from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { type InventoryMovement } from '../../inventory/api';
import { colors, radius, spacing, typography } from '../tokens';
import { EmptyState } from './EmptyState';
import { StatusBadge } from './StatusBadge';

export interface MovementLedgerModalProps {
  visible: boolean;
  listingName: string;
  movements: InventoryMovement[];
  onClose: () => void;
  loading?: boolean;
  testID?: string;
}

export function MovementLedgerModal({
  visible,
  listingName,
  movements,
  onClose,
  loading = false,
  testID,
}: MovementLedgerModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      testID={testID}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.titleGroup}>
              <Text style={styles.title}>Stock Ledger Trail</Text>
              <Text style={styles.subtitle} numberOfLines={1}>
                {listingName}
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel="Close movement ledger"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>

          {/* Ledger List */}
          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
          >
            {loading ? (
              <Text style={styles.loadingText}>Loading stock movements…</Text>
            ) : movements.length === 0 ? (
              <EmptyState
                title="No Movements Recorded"
                description="No historical stock ledger transactions found for this item."
              />
            ) : (
              movements.map((item, index) => {
                const isPositive = item.quantityDelta > 0;
                const isZero = item.quantityDelta === 0;
                return (
                  <View key={item.id || String(index)} style={styles.movementRow}>
                    <View style={styles.movementMeta}>
                      <Text style={styles.movementReason}>
                        {item.reason.replaceAll('_', ' ')}
                      </Text>
                      <Text style={styles.movementTimestamp}>
                        {new Date(item.occurredAt).toLocaleString('en-IN')}
                      </Text>
                      {item.sourceReference ? (
                        <Text style={styles.sourceRef}>Ref: {item.sourceReference}</Text>
                      ) : null}
                    </View>

                    <View style={styles.movementQtyGroup}>
                      <View
                        style={[
                          styles.deltaPill,
                          isPositive
                            ? styles.deltaPositive
                            : isZero
                            ? styles.deltaNeutral
                            : styles.deltaNegative,
                        ]}
                      >
                        <Text
                          style={[
                            styles.deltaText,
                            isPositive
                              ? styles.deltaTextPositive
                              : isZero
                              ? styles.deltaTextNeutral
                              : styles.deltaTextNegative,
                          ]}
                        >
                          {isPositive ? `+${item.quantityDelta}` : item.quantityDelta}
                        </Text>
                      </View>
                      <Text style={styles.resultingOnHand}>
                        → On Hand: {item.resultingOnHand}
                      </Text>
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>
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
    maxHeight: '80%',
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
  list: {
    flexGrow: 0,
  },
  listContent: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  loadingText: {
    ...typography.bodyMd,
    color: colors.slate500,
    textAlign: 'center',
    paddingVertical: spacing.lg,
  },
  movementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
    backgroundColor: colors.surfaceDim,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  movementMeta: {
    flex: 1,
    gap: 2,
  },
  movementReason: {
    ...typography.labelMd,
    color: colors.slate900,
    textTransform: 'capitalize',
    fontWeight: '700',
  },
  movementTimestamp: {
    ...typography.bodySm,
    fontSize: 11,
    color: colors.slate500,
  },
  sourceRef: {
    ...typography.codeSm,
    fontSize: 11,
    color: colors.slate600,
  },
  movementQtyGroup: {
    alignItems: 'flex-end',
    gap: 4,
  },
  deltaPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
  },
  deltaPositive: {
    backgroundColor: colors.successContainer,
  },
  deltaNegative: {
    backgroundColor: colors.errorContainer,
  },
  deltaNeutral: {
    backgroundColor: colors.slate200,
  },
  deltaText: {
    ...typography.labelMd,
    fontWeight: '800',
  },
  deltaTextPositive: {
    color: colors.onSuccessContainer,
  },
  deltaTextNegative: {
    color: colors.onErrorContainer,
  },
  deltaTextNeutral: {
    color: colors.slate700,
  },
  resultingOnHand: {
    ...typography.bodySm,
    fontSize: 11,
    color: colors.slate600,
  },
});
