import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { palette, radii, spacing, typography } from '../design/tokens';
import { CaptainDeliveryOffer } from '../features/delivery/types';
import { Button } from './Button';
import { MoneyAmount } from './MoneyAmount';
import { OfferCountdown } from './OfferCountdown';

export interface DeliveryOfferCardProps {
  offer: CaptainDeliveryOffer;
  loading?: boolean;
  onAccept: () => void;
  onReject: () => void;
  onExpired?: () => void;
}

export const DeliveryOfferCard: React.FC<DeliveryOfferCardProps> = ({
  offer,
  loading = false,
  onAccept,
  onReject,
  onExpired,
}) => {
  const distanceKm = offer.pickup?.distanceMeters
    ? (offer.pickup.distanceMeters / 1000).toFixed(1)
    : null;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.tag}>NEW DELIVERY REQUEST</Text>
        <Text style={styles.outletName}>
          {offer.pickup?.outletName || 'MyPet Store'}
        </Text>
        {offer.pickup?.area ? (
          <Text style={styles.areaText}>{offer.pickup.area}</Text>
        ) : null}
      </View>

      <View style={styles.detailsRow}>
        {distanceKm ? (
          <View style={styles.detailItem}>
            <Text style={styles.detailLabel}>DISTANCE</Text>
            <Text style={styles.detailValue}>{distanceKm} km</Text>
          </View>
        ) : null}

        {offer.package?.itemCount ? (
          <View style={styles.detailItem}>
            <Text style={styles.detailLabel}>PACKAGE</Text>
            <Text style={styles.detailValue}>{offer.package.itemCount} items</Text>
          </View>
        ) : null}

        <View style={styles.detailItem}>
          <Text style={styles.detailLabel}>EST. EARNING</Text>
          <MoneyAmount
            paise={offer.estimatedEarningPaise ?? 7500}
            style={styles.earningText}
          />
        </View>
      </View>

      <OfferCountdown expiresAt={offer.expiresAt} onExpired={onExpired} />

      <View style={styles.actions}>
        <Button
          disabled={loading}
          fullWidth={false}
          onPress={onReject}
          style={styles.rejectBtn}
          title="REJECT"
          variant="outline"
        />
        <Button
          disabled={loading}
          fullWidth={false}
          loading={loading}
          onPress={onAccept}
          style={styles.acceptBtn}
          title="ACCEPT"
          variant="success"
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.white,
    borderRadius: radii.card,
    borderWidth: 1.5,
    borderColor: palette.royalBlue,
    padding: spacing.lg,
    marginVertical: spacing.md,
    shadowColor: palette.ink,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  tag: {
    ...typography.caption,
    color: palette.royalBlue,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: spacing.xs,
  },
  outletName: {
    ...typography.headline,
    color: palette.ink,
    textAlign: 'center',
  },
  areaText: {
    ...typography.bodySmall,
    color: palette.inkMuted,
    marginTop: 2,
  },
  detailsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: palette.outlineSoft,
    marginVertical: spacing.sm,
  },
  detailItem: {
    alignItems: 'center',
  },
  detailLabel: {
    ...typography.caption,
    color: palette.inkMuted,
    marginBottom: 2,
  },
  detailValue: {
    ...typography.title,
    color: palette.ink,
    fontSize: 16,
  },
  earningText: {
    color: palette.emerald,
    fontSize: 18,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  rejectBtn: {
    flex: 1,
    borderColor: palette.error,
  },
  acceptBtn: {
    flex: 2,
  },
});
