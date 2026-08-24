import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
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
import { isUuid } from '../../../utils/uuid';

export default function DeliveryProofVerificationScreen() {
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const { activeDelivery, confirmDelivery } = useDeliveryStore();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const delivery = activeDelivery;
  useEffect(() => {
    if (!isUuid(jobId) || !delivery || delivery.jobId !== jobId) {
      router.replace('/(tabs)/home');
    }
  }, [jobId, delivery]);

  if (!isUuid(jobId) || !delivery || delivery.jobId !== jobId) return null;

  const handleConfirmDelivery = async () => {
    setError(null);
    setNotice('Confirming delivery…');
    setLoading(true);

    try {
      const outcome = await confirmDelivery(jobId, {
        type: 'PIN',
        pinCode: code,
        capturedAt: new Date().toISOString(),
      });

      if (outcome.outcome === 'ACKNOWLEDGED') {
        router.replace(`/delivery/${jobId}/completed` as any);
      } else if (outcome.outcome === 'UNKNOWN') {
        setNotice('Delivery sync pending. Checking delivery status…');
      } else if (outcome.outcome === 'PENDING') {
        setNotice('Delivery sync pending');
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
            <Text style={styles.headerSub}>VERIFY CUSTOMER DELIVERY</Text>
            <Text style={styles.headerTitle}>{delivery.orderReference || `Order #${delivery.orderId.slice(0, 8)}`}</Text>
            <Text style={styles.customerName}>{delivery.deliveryAddress?.recipientName}</Text>
          </View>

          <View style={styles.card}>
            {notice ? (
              <View style={styles.noticeBanner}>
                <Text style={styles.noticeText}>{notice}</Text>
              </View>
            ) : null}

            <ProofCodeInput
              error={error}
              instructions="Ask the customer for the 4-digit delivery PIN"
              label="Enter Delivery Code"
              length={4}
              onChange={(val) => {
                setCode(val);
                if (error) setError(null);
              }}
              value={code}
            />

            <Button
              disabled={loading || code.length !== 4 || delivery.state === 'UNKNOWN'}
              loading={loading}
              onPress={handleConfirmDelivery}
              style={styles.confirmBtn}
              title={loading ? 'Confirming delivery…' : 'COMPLETE DELIVERY'}
              variant="success"
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
  customerName: {
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
