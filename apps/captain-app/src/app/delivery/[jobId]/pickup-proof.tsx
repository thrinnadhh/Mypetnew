import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../../components/Button';
import { ProofCodeInput } from '../../../components/ProofCodeInput';
import { palette, spacing, typography } from '../../../design/tokens';
import { useDelivery } from '../../../features/delivery/delivery-context';
import { getFriendlyErrorMessage } from '../../../utils/errors';

export default function PickupProofVerificationScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const { activeDelivery, markPickedUp } = useDelivery();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const delivery = activeDelivery;
  if (!delivery) {
    router.replace('/(tabs)/home');
    return null;
  }

  const handleConfirmPickup = async () => {
    setError(null);
    setLoading(true);
    try {
      await markPickedUp();
      router.replace(`/delivery/${jobId}/customer` as any);
    } catch (err: any) {
      setError(getFriendlyErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardView}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <Text style={styles.headerSub}>VERIFY STORE PICKUP</Text>
            <Text style={styles.headerTitle}>{delivery.orderReference}</Text>
            <Text style={styles.merchantName}>{delivery.merchant?.name}</Text>
          </View>

          <View style={styles.card}>
            <ProofCodeInput
              error={error}
              instructions="Ask the store manager for the 4-digit pickup code"
              label="Enter Store Pickup Code"
              length={4}
              onChange={(val) => {
                setCode(val);
                if (error) setError(null);
              }}
              value={code}
            />

            <Button
              disabled={loading}
              loading={loading}
              onPress={handleConfirmPickup}
              style={styles.confirmBtn}
              title="CONFIRM PICKUP"
              variant="primary"
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: palette.coolWhite,
  },
  keyboardView: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    padding: spacing.lg,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  headerSub: {
    ...typography.caption,
    color: palette.royalBlue,
    letterSpacing: 1,
    fontWeight: '800',
  },
  headerTitle: {
    ...typography.headline,
    color: palette.ink,
    fontSize: 22,
    marginTop: 2,
  },
  merchantName: {
    ...typography.body,
    color: palette.inkMuted,
    marginTop: 2,
  },
  card: {
    backgroundColor: palette.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.outlineSoft,
    padding: spacing.xl,
    alignItems: 'center',
  },
  confirmBtn: {
    marginTop: spacing.lg,
  },
});
