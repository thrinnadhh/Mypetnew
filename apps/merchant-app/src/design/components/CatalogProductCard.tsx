import React from 'react';
import { Image, Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { type MerchantListing } from '../../catalog/api';
import { colors, radius, spacing, typography } from '../tokens';
import { formatPaise } from './OrderCard';
import { SecondaryButton } from './SecondaryButton';
import { StatusBadge } from './StatusBadge';

export interface CatalogProductCardProps {
  listing: MerchantListing;
  isPendingMedia?: boolean;
  canWrite?: boolean;
  saving?: boolean;
  uploadingMedia?: boolean;
  onEdit: (listing: MerchantListing) => void;
  onToggleStatus: (listing: MerchantListing) => void;
  onAddImage: (listing: MerchantListing) => void;
  onRetryUpload?: () => void;
  style?: ViewStyle;
  testID?: string;
}

export function CatalogProductCard({
  listing,
  isPendingMedia = false,
  canWrite = true,
  saving = false,
  uploadingMedia = false,
  onEdit,
  onToggleStatus,
  onAddImage,
  onRetryUpload,
  style,
  testID,
}: CatalogProductCardProps) {
  const isActive = listing.status === 'ACTIVE';
  const isMedicine = listing.kind === 'MEDICINE';
  const discountPaise = Math.max(0, listing.mrpPaise - listing.sellingPricePaise);
  const discountPercent =
    listing.mrpPaise > 0
      ? Math.round((discountPaise / listing.mrpPaise) * 100)
      : 0;

  const imageCount = listing.imageUrls.length;
  const firstImage = listing.imageUrls[0];
  const maxImages = 5;

  return (
    <View
      style={[
        styles.card,
        !isActive && styles.cardInactive,
        style,
      ]}
      accessibilityRole="text"
      accessibilityLabel={`Listing ${listing.name}, price ${formatPaise(listing.sellingPricePaise)}, status ${listing.status}`}
      testID={testID}
    >
      {/* Top Main Section */}
      <View style={styles.mainRow}>
        {/* Thumbnail */}
        <View style={styles.thumbnailContainer}>
          {firstImage ? (
            <Image
              source={{ uri: firstImage }}
              style={styles.thumbnail}
              accessibilityLabel={`Image of ${listing.name}`}
            />
          ) : (
            <View style={styles.thumbnailPlaceholder}>
              <Text style={styles.placeholderIcon}>{isMedicine ? '💊' : '🐾'}</Text>
            </View>
          )}
        </View>

        {/* Info Column */}
        <View style={styles.infoCol}>
          <View style={styles.titleRow}>
            <Text style={styles.title} numberOfLines={2}>
              {listing.name}
            </Text>
            <StatusBadge
              label={isActive ? 'Active' : 'Inactive'}
              variant={isActive ? 'success' : 'neutral'}
              testID={testID ? `${testID}-status-badge` : undefined}
            />
          </View>

          {/* Badges / Taxonomy */}
          <View style={styles.tagRow}>
            <View style={styles.categoryChip}>
              <Text style={styles.categoryText}>{listing.category}</Text>
            </View>
            {isMedicine ? (
              <View style={styles.medicineChip}>
                <Text style={styles.medicineText}>Medicine (View Only)</Text>
              </View>
            ) : null}
            {listing.brand ? (
              <Text style={styles.brandText}>{listing.brand}</Text>
            ) : null}
          </View>

          {/* Identifiers */}
          <View style={styles.idRow}>
            {listing.sku ? (
              <Text style={styles.idText}>SKU: {listing.sku}</Text>
            ) : null}
            <Text style={styles.idText}>
              {listing.barcodeType}: {listing.normalizedBarcode}
            </Text>
          </View>
        </View>
      </View>

      {/* Pricing & Image Quota Row */}
      <View style={styles.pricingRow}>
        <View style={styles.priceGroup}>
          <Text style={styles.sellingPrice}>
            {formatPaise(listing.sellingPricePaise)}
          </Text>
          {discountPaise > 0 ? (
            <View style={styles.mrpGroup}>
              <Text style={styles.mrpPrice}>{formatPaise(listing.mrpPaise)}</Text>
              <View style={styles.discountBadge}>
                <Text style={styles.discountText}>{discountPercent}% OFF</Text>
              </View>
            </View>
          ) : null}
        </View>

        <View style={styles.mediaPill}>
          <Text style={styles.mediaPillText}>
            📷 {imageCount}/{maxImages} Photos
          </Text>
        </View>
      </View>

      {/* Media Sync Warning / Retry Banner */}
      {isPendingMedia ? (
        <View style={styles.pendingMediaBanner}>
          <Text style={styles.pendingMediaText}>
            Image upload pending or needs retry.
          </Text>
          {onRetryUpload ? (
            <Pressable
              onPress={onRetryUpload}
              style={styles.retryUploadBtn}
              accessibilityRole="button"
              accessibilityLabel="Retry failed image upload"
            >
              <Text style={styles.retryUploadText}>Retry Upload</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {/* Operational Actions */}
      {canWrite ? (
        <View style={styles.actionsRow}>
          <SecondaryButton
            title="Edit"
            onPress={() => onEdit(listing)}
            disabled={saving || uploadingMedia}
            style={styles.actionBtn}
            testID={testID ? `${testID}-edit-btn` : undefined}
          />
          <SecondaryButton
            title={isActive ? 'Deactivate' : 'Activate'}
            onPress={() => onToggleStatus(listing)}
            disabled={saving || uploadingMedia}
            style={[
              styles.actionBtn,
              isActive && styles.deactivateBtn,
            ]}
            testID={testID ? `${testID}-toggle-status-btn` : undefined}
          />
          <SecondaryButton
            title={uploadingMedia && isPendingMedia ? 'Uploading…' : '+ Photo'}
            onPress={() => onAddImage(listing)}
            disabled={saving || uploadingMedia || imageCount >= maxImages || !isActive}
            style={styles.actionBtn}
            testID={testID ? `${testID}-add-photo-btn` : undefined}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.cardPadding,
    gap: spacing.sm,
    shadowColor: colors.slate900,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  cardInactive: {
    backgroundColor: '#fcfcfd',
    borderColor: colors.borderLight,
    opacity: 0.88,
  },
  mainRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  thumbnailContainer: {
    width: 64,
    height: 64,
    borderRadius: radius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.borderLight,
    backgroundColor: colors.surfaceDim,
  },
  thumbnail: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  thumbnailPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderIcon: {
    fontSize: 24,
  },
  infoCol: {
    flex: 1,
    gap: 4,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  title: {
    flex: 1,
    ...typography.headlineSm,
    fontSize: 16,
    lineHeight: 22,
    color: colors.slate900,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
  },
  categoryChip: {
    backgroundColor: colors.slate100,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  categoryText: {
    ...typography.bodySm,
    fontSize: 11,
    color: colors.slate700,
    fontWeight: '600',
  },
  medicineChip: {
    backgroundColor: colors.warningContainer,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  medicineText: {
    ...typography.bodySm,
    fontSize: 11,
    color: colors.onWarningContainer,
    fontWeight: '700',
  },
  brandText: {
    ...typography.bodySm,
    fontSize: 12,
    color: colors.slate600,
    fontStyle: 'italic',
  },
  idRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  idText: {
    ...typography.codeSm,
    fontSize: 11,
    color: colors.slate500,
  },
  pricingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.borderLight,
  },
  priceGroup: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.xs,
  },
  sellingPrice: {
    ...typography.headlineSm,
    fontSize: 18,
    fontWeight: '800',
    color: colors.primary,
  },
  mrpGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  mrpPrice: {
    ...typography.bodySm,
    color: colors.slate400,
    textDecorationLine: 'line-through',
  },
  discountBadge: {
    backgroundColor: colors.successContainer,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: radius.sm,
  },
  discountText: {
    ...typography.bodySm,
    fontSize: 10,
    color: colors.onSuccessContainer,
    fontWeight: '800',
  },
  mediaPill: {
    backgroundColor: colors.surfaceDim,
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 3,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  mediaPillText: {
    ...typography.bodySm,
    fontSize: 11,
    color: colors.slate600,
    fontWeight: '600',
  },
  pendingMediaBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.xs + 2,
    backgroundColor: colors.warningContainer,
    borderRadius: radius.sm,
  },
  pendingMediaText: {
    ...typography.bodySm,
    fontSize: 12,
    color: colors.onWarningContainer,
    fontWeight: '600',
  },
  retryUploadBtn: {
    minHeight: 28,
    paddingHorizontal: spacing.xs,
    justifyContent: 'center',
    backgroundColor: colors.warning,
    borderRadius: radius.sm,
  },
  retryUploadText: {
    ...typography.labelSm,
    fontSize: 11,
    color: colors.onWarning,
    fontWeight: '700',
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingTop: spacing.xs,
  },
  actionBtn: {
    flex: 1,
    minHeight: spacing.touchTargetMin,
  },
  deactivateBtn: {
    borderColor: '#fca5a5',
  },
});
