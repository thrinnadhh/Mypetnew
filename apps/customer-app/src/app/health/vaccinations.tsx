import React from 'react';
import { StyleSheet, View } from 'react-native';

import { StateView } from '@/components/foundation/primitives';
import { ScreenHeader } from '@/components/ui/screen-header';
import { spacing } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

/**
 * Vaccination tracking is not part of this release. MyPet deliberately renders
 * an explicit deferred state here instead of any local fixture data: fabricated
 * medical schedules would be unsafe to show as if they were real records.
 */
export default function VaccinationsScreen() {
  const theme = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ScreenHeader title="Vaccinations" subtitle="Health schedules & immunization" />
      <StateView
        kind="empty"
        title="Not part of this release yet"
        message="Vaccination schedules and reminders are not enabled in this version of MyPet. Your real health records live with your veterinary provider."
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.x3 },
});
