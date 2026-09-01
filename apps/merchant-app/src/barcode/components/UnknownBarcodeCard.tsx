import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { BarcodeType } from '../../catalog/api';
import { colors } from '../../design/tokens/colors';
import { typography } from '../../design/tokens/typography';
import { spacing } from '../../design/tokens/spacing';
import { radius } from '../../design/tokens/radius';

export type UnknownBarcodeCardProps = {
  barcodeType: BarcodeType;
  rawBarcode: string;
  canCreateDraft: boolean;
  onRetry: () => void;
  onCreateDraft: () => void;
  onManualEntry: () => void;
  onDismiss: () => void;
};

export function UnknownBarcodeCard({
  barcodeType,
  rawBarcode,
  canCreateDraft,
  onRetry,
  onCreateDraft,
  onManualEntry,
  onDismiss,
}: UnknownBarcodeCardProps) {
  return (
    <View style={styles.card} testID="unknown-barcode-card">
      <View style={styles.headerRow}>
        <View style={styles.titleContainer}>
          <Text style={styles.cardTitle}>Unknown Barcode</Text>
          <Text style={styles.barcodeText}>
            {barcodeType} · {rawBarcode}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss unknown barcode card"
          onPress={onDismiss}
          style={styles.closeButton}
        >
          <Text style={styles.closeButtonText}>✕</Text>
        </Pressable>
      </View>

      <Text style={styles.description}>
        This barcode is not yet mapped to any product in your outlet&apos;s catalog.
      </Text>

      <View style={styles.actionColumn}>
        {canCreateDraft ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Create product draft with this barcode"
            onPress={onCreateDraft}
            style={[styles.actionButton, styles.primaryButton]}
          >
            <Text style={styles.primaryButtonText}>Create Product Draft</Text>
          </Pressable>
        ) : null}

        <View style={styles.buttonRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry scanning"
            onPress={onRetry}
            style={[styles.actionButton, styles.secondaryButton]}
          >
            <Text style={styles.secondaryButtonText}>Retry Scan</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Search product manually"
            onPress={onManualEntry}
            style={[styles.actionButton, styles.secondaryButton]}
          >
            <Text style={styles.secondaryButtonText}>Search Catalog</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.warning,
    padding: spacing.md,
    gap: spacing.sm,
    shadowColor: colors.slate900,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  titleContainer: {
    flex: 1,
    gap: 2,
  },
  cardTitle: {
    ...typography.headlineMd,
    color: '#b45309',
  },
  barcodeText: {
    ...typography.codeSm,
    color: colors.onSurfaceVariant,
    fontSize: 12,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonText: {
    fontSize: 13,
    color: colors.onSurfaceVariant,
    fontWeight: '700',
  },
  description: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
  },
  actionColumn: {
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  actionButton: {
    minHeight: 48,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    flex: 1,
  },
  primaryButton: {
    backgroundColor: colors.primary,
  },
  primaryButtonText: {
    ...typography.labelLg,
    color: colors.onPrimary,
    fontWeight: '700',
  },
  secondaryButton: {
    backgroundColor: colors.surfaceDim,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryButtonText: {
    ...typography.labelMd,
    color: colors.onSurface,
  },
});
