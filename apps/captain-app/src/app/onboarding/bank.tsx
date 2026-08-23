import { router } from 'expo-router';
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
import { fetchOnboardingDraft, saveOnboardingDraft } from '../../api/onboarding';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { palette, spacing, typography } from '../../design/tokens';
import { isValidIfsc } from '../../utils/validation';

export default function BankDetailsScreen() {
  const [accountHolder, setAccountHolder] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [confirmAccountNumber, setConfirmAccountNumber] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [bankName, setBankName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchOnboardingDraft().then((draft) => {
      if (draft.bank) {
        setAccountHolder(draft.bank.accountHolder || '');
        setAccountNumber(draft.bank.accountNumber || '');
        setConfirmAccountNumber(draft.bank.accountNumber || '');
        setIfsc(draft.bank.ifsc || '');
        setBankName(draft.bank.bankName || '');
      }
    });
  }, []);

  const handleSave = async () => {
    setError(null);
    if (!accountHolder.trim()) {
      setError('Please enter the bank account holder name');
      return;
    }
    if (!accountNumber.trim()) {
      setError('Please enter your bank account number');
      return;
    }
    if (accountNumber !== confirmAccountNumber) {
      setError('Account numbers do not match');
      return;
    }
    if (!isValidIfsc(ifsc)) {
      setError('Please enter a valid 11-character IFSC code (e.g. SBIN0001234)');
      return;
    }

    setSaving(true);
    try {
      await saveOnboardingDraft({
        bank: {
          accountHolder: accountHolder.trim(),
          accountNumber: accountNumber.trim(),
          ifsc: ifsc.trim().toUpperCase(),
          bankName: bankName.trim() || 'Bank Partner',
        },
        stepCompleted: Math.max(4, 4),
      });
      router.push('/onboarding/documents');
    } catch {
      setError('Failed to save bank details. Please try again.');
    } finally {
      setSaving(false);
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
          <Text style={styles.stepIndicator}>STEP 4 OF 6</Text>
          <Text style={styles.title}>Bank Details</Text>
          <Text style={styles.subtitle}>
            Enter your bank account details for weekly delivery payouts and settlements.
          </Text>

          <Input
            error={error}
            label="Account Holder Name"
            onChangeText={setAccountHolder}
            placeholder="As registered in your bank account"
            value={accountHolder}
          />

          <Input
            keyboardType="number-pad"
            label="Account Number"
            onChangeText={setAccountNumber}
            placeholder="Enter bank account number"
            secureTextEntry
            value={accountNumber}
          />

          <Input
            keyboardType="number-pad"
            label="Confirm Account Number"
            onChangeText={setConfirmAccountNumber}
            placeholder="Re-enter bank account number"
            value={confirmAccountNumber}
          />

          <Input
            autoCapitalize="characters"
            label="IFSC Code"
            maxLength={11}
            onChangeText={setIfsc}
            placeholder="e.g. SBIN0001234"
            value={ifsc}
          />

          <Input
            label="Bank Name (Optional)"
            onChangeText={setBankName}
            placeholder="e.g. State Bank of India"
            value={bankName}
          />

          <View style={styles.securityNote}>
            <Text style={styles.securityIcon}>🔒</Text>
            <Text style={styles.securityText}>
              Your bank details are encrypted and securely stored. We only use them for payouts.
            </Text>
          </View>

          <View style={styles.actionRow}>
            <Button
              loading={saving}
              onPress={handleSave}
              title="Save & Continue"
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
    padding: spacing.lg,
  },
  stepIndicator: {
    ...typography.caption,
    color: palette.royalBlue,
    letterSpacing: 1,
    marginBottom: 2,
  },
  title: {
    ...typography.display,
    color: palette.ink,
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 4,
  },
  subtitle: {
    ...typography.bodySmall,
    color: palette.inkMuted,
    marginBottom: spacing.lg,
  },
  securityNote: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: palette.royalBlueSoft,
    padding: spacing.md,
    borderRadius: 8,
    gap: spacing.sm,
    marginVertical: spacing.md,
  },
  securityIcon: {
    fontSize: 20,
  },
  securityText: {
    ...typography.caption,
    color: palette.royalBlue,
    flex: 1,
    lineHeight: 16,
  },
  actionRow: {
    marginTop: spacing.md,
    marginBottom: spacing.xl,
  },
});
