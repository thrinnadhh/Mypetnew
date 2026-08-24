import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { CaptainApprovalStatus } from '../auth/types';
import { palette, radii, spacing, typography } from '../design/tokens';
import { Button } from './Button';
import { StatusBadge } from './StatusBadge';

export interface CaptainStatusCardProps {
  status: CaptainApprovalStatus;
  rejectionReason?: string | null;
  onAction?: () => void;
  style?: ViewStyle;
}

export const CaptainStatusCard: React.FC<CaptainStatusCardProps> = ({
  status,
  rejectionReason,
  onAction,
  style,
}) => {
  const getStatusContent = () => {
    switch (status) {
      case 'DRAFT':
        return {
          title: 'Complete Your Profile',
          message: 'Fill in your personal, vehicle, and bank details to start delivering.',
          actionText: 'Continue Onboarding',
          badge: 'DRAFT',
          variant: 'pending' as const,
        };
      case 'SUBMITTED':
        return {
          title: 'Application Submitted',
          message: 'Your Captain application has been received. We will notify you once reviewed.',
          actionText: 'Check Status',
          badge: 'SUBMITTED',
          variant: 'pending' as const,
        };
      case 'UNDER_REVIEW':
        return {
          title: 'Verification In Progress',
          message: 'Our operations team is currently verifying your submitted documents.',
          actionText: 'View Details',
          badge: 'UNDER REVIEW',
          variant: 'warning' as const,
        };
      case 'REJECTED':
        return {
          title: 'Action Required',
          message:
            rejectionReason ||
            'Your verification could not be completed. Please review and update your details.',
          actionText: 'Update Details',
          badge: 'REJECTED',
          variant: 'error' as const,
        };
      case 'SUSPENDED':
        return {
          title: 'Account Unavailable',
          message: 'You cannot accept deliveries currently. Please contact Captain support.',
          actionText: 'Contact Support',
          badge: 'SUSPENDED',
          variant: 'error' as const,
        };
      case 'ACTIVE':
      default:
        return {
          title: 'Account Active',
          message: 'You are an approved delivery partner ready to take orders.',
          actionText: null,
          badge: 'ACTIVE',
          variant: 'active' as const,
        };
    }
  };

  const content = getStatusContent();

  return (
    <View style={[styles.card, style]}>
      <View style={styles.header}>
        <Text style={styles.title}>{content.title}</Text>
        <StatusBadge label={content.badge} variant={content.variant} />
      </View>
      <Text style={styles.message}>{content.message}</Text>
      {content.actionText && onAction ? (
        <Button
          onPress={onAction}
          style={styles.button}
          title={content.actionText}
          variant={status === 'REJECTED' || status === 'SUSPENDED' ? 'outline' : 'primary'}
        />
      ) : null}
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  title: {
    ...typography.headline,
    color: palette.ink,
    fontSize: 18,
    flex: 1,
    marginRight: spacing.sm,
  },
  message: {
    ...typography.body,
    color: palette.inkMuted,
    lineHeight: 20,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  button: {
    marginTop: spacing.xs,
  },
});
