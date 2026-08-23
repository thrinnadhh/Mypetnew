import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { palette, radii, spacing, typography } from '../design/tokens';

export interface DeliveryTimelineProps {
  status: 'ASSIGNED' | 'PICKED_UP' | 'DELIVERED';
}

export const DeliveryTimeline: React.FC<DeliveryTimelineProps> = ({ status }) => {
  const steps = [
    { label: 'Assigned', active: true, completed: status === 'PICKED_UP' || status === 'DELIVERED' },
    { label: 'Pickup', active: status === 'ASSIGNED' || status === 'PICKED_UP' || status === 'DELIVERED', completed: status === 'PICKED_UP' || status === 'DELIVERED' },
    { label: 'Customer', active: status === 'PICKED_UP' || status === 'DELIVERED', completed: status === 'DELIVERED' },
    { label: 'Delivered', active: status === 'DELIVERED', completed: status === 'DELIVERED' },
  ];

  return (
    <View style={styles.container}>
      {steps.map((step, idx) => (
        <React.Fragment key={step.label}>
          <View style={styles.stepItem}>
            <View
              style={[
                styles.circle,
                step.completed && styles.circleCompleted,
                step.active && !step.completed && styles.circleActive,
              ]}
            >
              <Text
                style={[
                  styles.circleText,
                  (step.completed || step.active) && styles.circleTextActive,
                ]}
              >
                {step.completed ? '✓' : idx + 1}
              </Text>
            </View>
            <Text
              style={[
                styles.stepLabel,
                step.active && styles.stepLabelActive,
              ]}
            >
              {step.label}
            </Text>
          </View>
          {idx < steps.length - 1 ? (
            <View
              style={[
                styles.line,
                steps[idx + 1].active && styles.lineActive,
              ]}
            />
          ) : null}
        </React.Fragment>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  stepItem: {
    alignItems: 'center',
  },
  circle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: palette.outlineSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  circleActive: {
    backgroundColor: palette.royalBlue,
  },
  circleCompleted: {
    backgroundColor: palette.emerald,
  },
  circleText: {
    ...typography.caption,
    color: palette.inkMuted,
    fontWeight: '700',
  },
  circleTextActive: {
    color: palette.white,
  },
  stepLabel: {
    ...typography.caption,
    color: palette.inkMuted,
    fontSize: 10,
  },
  stepLabelActive: {
    color: palette.ink,
    fontWeight: '700',
  },
  line: {
    flex: 1,
    height: 2,
    backgroundColor: palette.outlineSoft,
    marginHorizontal: spacing.xs,
    marginBottom: spacing.md,
  },
  lineActive: {
    backgroundColor: palette.emerald,
  },
});
