import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createSupportTicket, SupportCategory } from '../../api/support';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { palette, radii, spacing, typography } from '../../design/tokens';
import { getFriendlyErrorMessage } from '../../utils/errors';

export default function NewSupportTicketScreen() {
  const { category, jobId, orderReference } = useLocalSearchParams<{
    category: SupportCategory;
    jobId?: string;
    orderReference?: string;
  }>();

  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    if (!subject.trim()) {
      setError('Please enter a subject');
      return;
    }
    if (!description.trim()) {
      setError('Please provide a brief description of the issue');
      return;
    }

    setLoading(true);
    try {
      const result = await createSupportTicket({
        category: category || 'OTHER',
        subject: subject.trim(),
        description: description.trim(),
        jobId: jobId || null,
        orderReference: orderReference || null,
      });

      Alert.alert(
        'Support Request Received',
        `Ticket #${result.ticketId} has been created. A support executive will contact you shortly.`,
        [
          {
            text: 'OK',
            onPress: () => router.replace('/support'),
          },
        ],
      );
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
          <Text style={styles.title}>Submit Support Request</Text>
          <Text style={styles.subtitle}>
            Category: <Text style={styles.catName}>{category || 'GENERAL'}</Text>
          </Text>

          {orderReference ? (
            <View style={styles.contextCard}>
              <Text style={styles.contextLabel}>ATTACHED DELIVERY CONTEXT</Text>
              <Text style={styles.contextRef}>{orderReference}</Text>
              <Text style={styles.contextSub}>Job ID: {jobId}</Text>
            </View>
          ) : null}

          <Input
            error={error}
            label="Subject"
            onChangeText={setSubject}
            placeholder="Brief summary of the issue"
            value={subject}
          />

          <Input
            label="Detailed Description"
            multiline
            numberOfLines={5}
            onChangeText={setDescription}
            placeholder="Explain what happened so our operations team can assist you immediately..."
            style={styles.textArea}
            value={description}
          />

          <View style={styles.actions}>
            <Button
              disabled={loading}
              loading={loading}
              onPress={handleSubmit}
              title="Submit Ticket"
              variant="primary"
            />
            <Button
              onPress={() => router.back()}
              title="Cancel"
              variant="secondary"
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
  title: {
    ...typography.display,
    color: palette.ink,
    fontSize: 22,
    fontWeight: '800',
  },
  subtitle: {
    ...typography.body,
    color: palette.inkMuted,
    marginTop: 4,
    marginBottom: spacing.lg,
  },
  catName: {
    color: palette.royalBlue,
    fontWeight: '700',
  },
  contextCard: {
    backgroundColor: palette.royalBlueSoft,
    borderRadius: radii.compact,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  contextLabel: {
    ...typography.caption,
    color: palette.royalBlue,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  contextRef: {
    ...typography.title,
    color: palette.ink,
    fontSize: 16,
    marginTop: 2,
  },
  contextSub: {
    ...typography.caption,
    color: palette.inkMuted,
    marginTop: 2,
  },
  textArea: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  actions: {
    gap: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.xxl,
  },
});
