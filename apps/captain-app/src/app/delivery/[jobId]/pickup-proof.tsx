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
import { useDeliveryStore } from '../../../state/delivery-store';

export default function PickupProofVerificationScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const { activeDelivery, confirmPickup } = useDeliveryStore();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const delivery = activeDelivery;
  if (!delivery) {
    router.replace('/(tabs)/home');
    return null;
  }

  const handleConfirmPickup = async () => {
    setError(null);
    setNotice('Confirming pickup…');
    setLoading(true);

    try {
      const outcome = await confirmPickup(jobId, {
        type: 'PIN',
        pinCode: code,
        capturedAt: new Date().toISOString(),
      });

      if (outcome.outcome === 'ACKNOWLEDGED') {
        router.replace(`/delivery/${jobId}/customer` as any);
      } else if (outcome.outcome === 'UNKNOWN') {
        setNotice('Pickup sync pending. Checking delivery status…');
      } else if (outcome.outcome === 'PENDING') {
        setNotice('Pickup sync pending');
      } else {
        setNotice(null);
        setError(outcome.error.message);
      }
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
            <Text style={styles.headerTitle}>{delivery.orderReference || `Order #${delivery.orderId.slice(0, 8)}`}</Text>
            <Text style={styles.merchantName}>{delivery.outletName}</Text>
          </View>

          <View style={styles.card}>
            {notice ? (
              <View style={styles.noticeBanner}>
                <Text style={styles.noticeText}>{notice}</Text>
              </View>
            ) : null}

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
              title={loading ? 'Confirming pickup…' : 'CONFIRM PICKUP'}
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
  noticeBanner: {
    backgroundColor: '#FEF3C7',
    padding: spacing.md,
    borderRadius: 8,
    marginBottom: spacing.md,
    width: '100%',
  },
  noticeText: {
    ...typography.bodySmall,
    color: '#92400E',
    textAlign: 'center',
    fontWeight: '600',
  },
  confirmBtn: {
    marginTop: spacing.lg,
  },
});
