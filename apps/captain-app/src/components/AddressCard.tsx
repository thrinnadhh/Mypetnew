import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { palette, radii, spacing, typography } from '../design/tokens';
import { ContactButton } from './ContactButton';
import { NavigationButton } from './NavigationButton';

export interface AddressCardProps {
  title: string;
  name?: string;
  address?: string;
  phone?: string | null;
  instructions?: string | null;
  latitude?: number;
  longitude?: number;
  style?: ViewStyle;
}

export const AddressCard: React.FC<AddressCardProps> = ({
  title,
  name,
  address,
  phone,
  instructions,
  latitude,
  longitude,
  style,
}) => {
  return (
    <View style={[styles.card, style]}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {name ? <Text style={styles.name}>{name}</Text> : null}
      <Text style={styles.address}>{address || 'Address not available'}</Text>

      {instructions ? (
        <View style={styles.instructionsContainer}>
          <Text style={styles.instructionsLabel}>Instructions:</Text>
          <Text style={styles.instructionsText}>{instructions}</Text>
        </View>
      ) : null}

      <View style={styles.actionsRow}>
        <NavigationButton
          destination={{
            latitude,
            longitude,
            address,
            label: name || title,
          }}
          style={styles.actionBtn}
        />
        {phone ? <ContactButton phoneNumber={phone} style={styles.actionBtn} /> : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: palette.white,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: palette.outlineSoft,
    padding: spacing.lg,
    marginVertical: spacing.sm,
  },
  sectionTitle: {
    ...typography.caption,
    color: palette.royalBlue,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  name: {
    ...typography.headline,
    color: palette.ink,
    fontSize: 18,
    marginBottom: 4,
  },
  address: {
    ...typography.body,
    color: palette.inkMuted,
    lineHeight: 20,
  },
  instructionsContainer: {
    backgroundColor: palette.amberSoft,
    borderRadius: radii.xs,
    padding: spacing.sm,
    marginTop: spacing.md,
  },
  instructionsLabel: {
    ...typography.caption,
    color: '#92400E',
    fontWeight: '700',
  },
  instructionsText: {
    ...typography.bodySmall,
    color: '#92400E',
    marginTop: 2,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  actionBtn: {
    flex: 1,
  },
});
