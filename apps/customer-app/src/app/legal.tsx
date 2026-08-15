import React from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, useColorScheme, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Radius, Spacing } from '@/constants/theme';

const SECTIONS = [
  {
    title: 'Terms',
    body: 'MyPet connects pet parents with stores, vets, groomers, captains, and support teams. Users must provide accurate account, address, pet, order, appointment, and billing information.',
  },
  {
    title: 'Privacy',
    body: 'MyPet uses account, pet care, location, payment, invoice, review, support, and push-token data only to operate platform workflows, support, security, and legal obligations.',
  },
  {
    title: 'Refunds',
    body: 'Refunds and cancellations depend on order, appointment, billing, payment, delivery, and dispute state. Completed visits and delivered orders require support review.',
  },
  {
    title: 'Disputes',
    body: 'Support can request information, escalate refunds, review payout claims, and resolve support cases. High-severity launch disputes can pause rollout.',
  },
];

export default function LegalScreen() {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const colors = Colors[scheme];
  const router = useRouter();

  return (
    <ThemedView style={[styles.container, { backgroundColor: colors.background }]}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <TouchableOpacity onPress={() => router.back()} style={[styles.backButton, { borderColor: colors.border }]}>
            <ThemedText style={{ color: colors.text, fontWeight: '900' }}>Back</ThemedText>
          </TouchableOpacity>
          <ThemedText style={[styles.title, { color: colors.text }]}>Legal And Support</ThemedText>
          {SECTIONS.map((section) => (
            <View key={section.title} style={[styles.card, { backgroundColor: colors.backgroundElement, borderColor: colors.border }]}>
              <ThemedText style={[styles.cardTitle, { color: colors.text }]}>{section.title}</ThemedText>
              <ThemedText style={{ color: colors.textSecondary }}>{section.body}</ThemedText>
            </View>
          ))}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1 },
  content: { padding: Spacing.four, gap: Spacing.three },
  backButton: {
    alignSelf: 'flex-start',
    minHeight: 40,
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
    justifyContent: 'center',
  },
  title: { fontSize: 24, fontWeight: '900' },
  card: {
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  cardTitle: { fontSize: 18, fontWeight: '900' },
});
