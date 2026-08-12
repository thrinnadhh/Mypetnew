import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import {
  AppBar,
  FilterChip,
  PrimaryAction,
  SectionHeader,
  StateView,
  StatusBadge,
} from '@/components/foundation/primitives';
import { ScreenShell } from '@/components/foundation/screen-shell';
import { ThemedText } from '@/components/themed-text';
import { AppCard } from '@/components/ui/app-card';
import { TextField } from '@/components/ui/text-field';
import { apiErrorMessage } from '@/contracts/api-error';
import { useAuth } from '@/context/AuthContext';
import { useAuthIntent } from '@/context/AuthIntentContext';
import { spacing, typography } from '@/design/tokens';
import {
  createCustomerCase,
  fetchCustomerCases,
  getCustomerCaseEvidenceLink,
  uploadCustomerCaseEvidence,
  type CustomerCase,
  type CustomerCaseType,
} from '@/services/customer-cases';

const CASE_TYPES: Array<{ value: CustomerCaseType; label: string }> = [
  { value: 'MISSING_ITEM', label: 'Missing item' },
  { value: 'DAMAGED_ITEM', label: 'Damaged item' },
  { value: 'WRONG_ITEM', label: 'Wrong item' },
  { value: 'LATE_DELIVERY', label: 'Late delivery' },
  { value: 'PAYMENT_ISSUE', label: 'Payment issue' },
  { value: 'OTHER', label: 'Other' },
];

function fileName(uri: string, value?: string | null): string {
  return value?.trim() || uri.split('/').pop() || `case-evidence-${Date.now()}.jpg`;
}

function dateTime(value: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function tone(status: CustomerCase['status']): 'success' | 'warning' | 'error' | 'neutral' {
  if (status === 'RESOLVED') return 'success';
  if (status === 'REJECTED') return 'error';
  if (status === 'UNDER_REVIEW') return 'warning';
  return 'neutral';
}

export default function CustomerSupportScreen() {
  const params = useLocalSearchParams<{ orderId?: string }>();
  const { user, session } = useAuth();
  const { requireAuth } = useAuthIntent();
  const [cases, setCases] = useState<CustomerCase[]>([]);
  const [caseType, setCaseType] = useState<CustomerCaseType>('MISSING_ITEM');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    if (!session) {
      setLoading(false);
      return;
    }
    setError(null);
    try {
      setCases(await fetchCustomerCases(session.access_token));
    } catch (nextError) {
      setError(nextError);
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const create = useCallback(async () => {
    if (!session || !params.orderId) return;
    if (description.trim().length < 10) {
      Alert.alert('Add more detail', 'Describe the problem using at least 10 characters.');
      return;
    }
    setBusyId('create');
    try {
      const created = await createCustomerCase(params.orderId, caseType, description, session.access_token);
      setCases((current) => [created, ...current]);
      setDescription('');
      Alert.alert('Support case created', 'MyPet recorded the order, issue type and customer ownership. You may attach private evidence now.');
    } catch (nextError) {
      Alert.alert('Could not create case', apiErrorMessage(nextError));
    } finally {
      setBusyId(null);
    }
  }, [caseType, description, params.orderId, session]);

  const addEvidence = useCallback(async (customerCase: CustomerCase) => {
    if (!session) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Photo permission required', 'Allow photo access to attach private order evidence.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: false,
      quality: 1,
    });
    const asset = result.canceled ? null : result.assets[0];
    if (!asset) return;
    setBusyId(customerCase.caseId);
    try {
      const evidence = await uploadCustomerCaseEvidence(
        customerCase,
        {
          uri: asset.uri,
          name: fileName(asset.uri, asset.fileName),
          mimeType: asset.mimeType ?? 'image/jpeg',
        },
        session.access_token,
      );
      setCases((current) => current.map((item) => item.caseId === customerCase.caseId
        ? { ...item, evidence: [...item.evidence, evidence] }
        : item));
      Alert.alert('Evidence uploaded', 'The evidence is private and available only through a short-lived signed link.');
    } catch (nextError) {
      Alert.alert('Evidence upload failed', apiErrorMessage(nextError));
    } finally {
      setBusyId(null);
    }
  }, [session]);

  const openEvidence = useCallback(async (customerCase: CustomerCase, evidenceId: string) => {
    if (!session) return;
    try {
      const url = await getCustomerCaseEvidenceLink(customerCase.caseId, evidenceId, session.access_token);
      await Linking.openURL(url);
    } catch (nextError) {
      Alert.alert('Evidence unavailable', apiErrorMessage(nextError));
    }
  }, [session]);

  if (!user || !session) {
    return (
      <ScreenShell scroll={false} header={<AppBar title="Support and disputes" subtitle="Order-specific help and refund tracking" />}>
        <StateView
          kind="unauthenticated"
          title="Sign in for order support"
          message="Support cases are restricted to the customer who owns the order."
          actionLabel="Sign in"
          onAction={() => void requireAuth({ action: 'ORDER_HISTORY', returnTo: '/support' })}
        />
      </ScreenShell>
    );
  }

  if (loading) {
    return (
      <ScreenShell scroll={false} header={<AppBar title="Support and disputes" />}>
        <StateView kind="loading" title="Loading your support cases" />
      </ScreenShell>
    );
  }

  return (
    <ScreenShell
      testID="customer-support-cases"
      header={<AppBar title="Support and disputes" subtitle="Missing, damaged, wrong, late or payment-related orders" />}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
    >
      {params.orderId ? (
        <AppCard style={styles.card}>
          <SectionHeader title="Create a case" />
          <ThemedText type="small" themeColor="textSecondary">
            Order #{params.orderId.slice(0, 8).toUpperCase()}
          </ThemedText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
            {CASE_TYPES.map((item) => (
              <FilterChip key={item.value} label={item.label} selected={caseType === item.value} onPress={() => setCaseType(item.value)} />
            ))}
          </ScrollView>
          <TextField
            label="What happened?"
            value={description}
            onChangeText={setDescription}
            multiline
            placeholder="Include which item, what was wrong and what resolution you need."
          />
          <PrimaryAction label="Create support case" loading={busyId === 'create'} onPress={() => void create()} />
        </AppCard>
      ) : (
        <StateView kind="empty" title="Choose an order first" message="Open an order and select Get help to start an order-specific case." />
      )}

      {error ? (
        <StateView kind="error" title="Support cases unavailable" message={apiErrorMessage(error)} actionLabel="Retry" onAction={() => void load()} />
      ) : null}

      <SectionHeader title="Your cases" />
      <ThemedText type="small" themeColor="textSecondary">{cases.length} total</ThemedText>
      {!error && cases.length === 0 ? (
        <StateView kind="empty" title="No support cases" message="Any case you create will show its review and refund status here." />
      ) : cases.map((customerCase) => (
        <AppCard key={customerCase.caseId} style={styles.card}>
          <View style={styles.headerRow}>
            <View style={styles.flex}>
              <ThemedText style={styles.title}>{customerCase.caseType.replaceAll('_', ' ')}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Order #{customerCase.orderId.slice(0, 8).toUpperCase()} · {dateTime(customerCase.createdAt)}
              </ThemedText>
            </View>
            <StatusBadge label={customerCase.status.replaceAll('_', ' ')} tone={tone(customerCase.status)} />
          </View>
          <ThemedText>{customerCase.description}</ThemedText>
          <View style={styles.row}>
            <StatusBadge label={`Refund: ${customerCase.refundStatus.replaceAll('_', ' ')}`} tone={customerCase.refundStatus === 'COMPLETED' ? 'success' : 'neutral'} />
            <StatusBadge label={`${customerCase.evidence.length} evidence`} tone="neutral" />
          </View>
          {customerCase.resolutionNotes ? (
            <ThemedText type="small" themeColor="textSecondary">Resolution: {customerCase.resolutionNotes}</ThemedText>
          ) : null}
          {customerCase.evidence.map((evidence) => (
            <FilterChip
              key={evidence.evidenceId}
              label={`View ${evidence.originalFilename}`}
              selected={false}
              onPress={() => void openEvidence(customerCase, evidence.evidenceId)}
            />
          ))}
          {customerCase.status !== 'RESOLVED' && customerCase.status !== 'REJECTED' ? (
            <PrimaryAction
              label="Attach private evidence"
              loading={busyId === customerCase.caseId}
              onPress={() => void addEvidence(customerCase)}
            />
          ) : null}
        </AppCard>
      ))}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.x3 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.x2 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.x3 },
  flex: { flex: 1 },
  title: { ...typography.title },
});
