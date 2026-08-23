import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AppIcon } from '@/components/app-icon';
import { AppBar, StateView } from '@/components/foundation/primitives';
import { ScreenShell } from '@/components/foundation/screen-shell';
import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/context/AuthContext';
import { useAuthIntent } from '@/context/AuthIntentContext';
import { palette, radii, shadows, spacing, touchTarget, typography } from '@/design/tokens';
import { useTheme } from '@/hooks/use-theme';

interface MerchantStarCard {
  outletId: string;
  merchantName: string;
  category: string;
  stars: number;
  maxStars: number;
  availableRewards: number;
  lastVisit: string;
}

const SAMPLE_STAR_CARDS: MerchantStarCard[] = [
  {
    outletId: 'out-paws-bubbles',
    merchantName: 'Paws & Bubbles Spa',
    category: 'Grooming & Spa',
    stars: 7,
    maxStars: 10,
    availableRewards: 1,
    lastVisit: 'Yesterday',
  },
  {
    outletId: 'out-healthy-hound',
    merchantName: 'The Healthy Hound Nutrition Hub',
    category: 'Pet Store & Nutrition',
    stars: 4,
    maxStars: 10,
    availableRewards: 0,
    lastVisit: '3 days ago',
  },
  {
    outletId: 'out-city-hospital',
    merchantName: 'City Pet Hospital & Clinic',
    category: 'Veterinary Hospital',
    stars: 9,
    maxStars: 10,
    availableRewards: 0,
    lastVisit: 'Last week',
  },
];

export default function WalletScreen() {
  const router = useRouter();
  const theme = useTheme();
  const { user, session } = useAuth();
  const { requireAuth } = useAuthIntent();
  const [tokenCounter, setTokenCounter] = useState(1);

  if (!user || !session) {
    return (
      <ScreenShell scroll={false} header={<AppBar title="My Loyalty" />}>
        <StateView
          kind="unauthenticated"
          title="Sign in to view loyalty pass"
          message="Your loyalty stars and in-store QR pass are stored with your MyPet account."
          actionLabel="Sign In"
          onAction={() => void requireAuth({ action: 'CHECKOUT', returnTo: '/wallet' })}
        />
      </ScreenShell>
    );
  }

  const challengeCode = `MYPET-LOY-${user.id ? user.id.slice(0, 8).toUpperCase() : 'PASS'}-${tokenCounter}`;

  return (
    <ScreenShell header={<AppBar title="My Loyalty Pass" subtitle="In-store QR pass & merchant star rewards" />}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        {/* Customer In-Store QR Pass Card */}
        <View style={[styles.qrCard, shadows.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
          <View style={styles.qrHeader}>
            <View>
              <ThemedText style={styles.memberName}>{user.displayName || 'Pet Parent'}</ThemedText>
              <ThemedText themeColor="textSecondary" style={styles.memberMobile}>
                {user.phone || '+91 ••••• •••••'}
              </ThemedText>
            </View>
            <View style={styles.verifiedBadge}>
              <ThemedText style={styles.verifiedBadgeText}>MEMBER PASS</ThemedText>
            </View>
          </View>

          {/* Simulated In-Store QR Matrix */}
          <View style={styles.qrMatrixContainer}>
            <View style={styles.qrMatrixBox}>
              <View style={styles.qrCornerTopLeft} />
              <View style={styles.qrCornerTopRight} />
              <View style={styles.qrCornerBottomLeft} />
              <View style={styles.qrCenterIcon}>
                <Text style={styles.qrEmoji}>🐾</Text>
              </View>
              <View style={styles.qrPatternSim}>
                <Text style={styles.qrPatternText}>■ ▄ ■ █ ▄ ■ █ ▄ ■ █ ▄ ■</Text>
                <Text style={styles.qrPatternText}>█ ▄ ■ █ ▄ ■ █ ▄ ■ █ ▄ ■</Text>
                <Text style={styles.qrPatternText}>■ ▄ ■ █ ▄ ■ █ ▄ ■ █ ▄ ■</Text>
              </View>
            </View>
            <Text style={styles.qrCodeLabel}>{challengeCode}</Text>
            <Text style={styles.qrInstructions}>
              Show this QR code at checkout to earn stars & redeem discounts
            </Text>
          </View>

          <Pressable
            style={styles.refreshQrBtn}
            onPress={() => {
              setTokenCounter((prev) => prev + 1);
              Alert.alert('Pass Refreshed', 'Generated fresh dynamic security token.');
            }}
            accessibilityRole="button"
          >
            <Text style={styles.refreshQrText}>🔄 Refresh Dynamic Pass</Text>
          </Pressable>
        </View>

        {/* Merchant Star Balances */}
        <View style={styles.sectionHeader}>
          <ThemedText style={styles.sectionTitle}>Loyalty belongs to each merchant</ThemedText>
        </View>

        {SAMPLE_STAR_CARDS.map((item) => {
          const starsRemaining = item.maxStars - item.stars;
          return (
            <View
              key={item.outletId}
              style={[styles.starCard, shadows.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}
            >
              <View style={styles.starCardTop}>
                <View style={styles.starCardInfo}>
                  <ThemedText style={styles.merchantTitle}>{item.merchantName}</ThemedText>
                  <ThemedText themeColor="textSecondary" style={styles.merchantCat}>
                    {item.category} · Last visit: {item.lastVisit}
                  </ThemedText>
                </View>
                <View style={styles.starPill}>
                  <Text style={styles.starPillText}>⭐ {item.stars}/{item.maxStars}</Text>
                </View>
              </View>

              {/* Star Progress Track */}
              <View style={styles.starProgressRow}>
                {Array.from({ length: item.maxStars }).map((_, index) => (
                  <View
                    key={index}
                    style={[
                      styles.starDot,
                      index < item.stars ? styles.starDotFilled : styles.starDotEmpty,
                    ]}
                  >
                    <Text style={styles.starDotIcon}>{index < item.stars ? '⭐' : '·'}</Text>
                  </View>
                ))}
              </View>

              <View style={styles.starCardFooter}>
                {item.availableRewards > 0 ? (
                  <View style={styles.rewardAvailableTag}>
                    <Text style={styles.rewardAvailableText}>🎉 1 Reward Ready (₹150 Off)</Text>
                  </View>
                ) : (
                  <ThemedText themeColor="textSecondary" style={styles.starsLeftText}>
                    {starsRemaining} more star{starsRemaining > 1 ? 's' : ''} for ₹150 voucher
                  </ThemedText>
                )}
                <Pressable
                  onPress={() => router.push('/stores' as never)}
                  accessibilityRole="button"
                >
                  <ThemedText style={styles.visitStoreLink}>Visit Store →</ThemedText>
                </Pressable>
              </View>
            </View>
          );
        })}

        {/* How It Works Guide */}
        <View style={[styles.infoCard, { backgroundColor: '#F8FAFC', borderColor: '#E2E8F0' }]}>
          <View style={styles.infoTitleRow}>
            <AppIcon name="sparkle" size={20} color={palette.royalBlue} />
            <ThemedText style={styles.infoTitle}>How MyPet Loyalty Works</ThemedText>
          </View>
          <ThemedText themeColor="textSecondary" style={styles.infoBody}>
            • Earn 1 Star for every in-store or online visit with the merchant.{'\n'}
            • Reach 10 Stars to unlock an instant ₹150 discount on your bill.{'\n'}
            • Stars are stored separately for each merchant partner.
          </ThemedText>
        </View>
      </ScrollView>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.x4, gap: spacing.x4, paddingBottom: spacing.x8 },
  qrCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.card,
    padding: spacing.x4,
    gap: spacing.x3,
  },
  qrHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  memberName: { ...typography.headline, fontSize: 18, fontWeight: '800' },
  memberMobile: { ...typography.caption, fontSize: 13, marginTop: 2 },
  verifiedBadge: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: spacing.x2,
    paddingVertical: spacing.x1,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: palette.royalBlue,
  },
  verifiedBadgeText: { ...typography.caption, fontSize: 10, fontWeight: '800', color: palette.royalBlue },
  qrMatrixContainer: {
    backgroundColor: '#0F172A',
    borderRadius: radii.compact,
    padding: spacing.x4,
    alignItems: 'center',
    gap: spacing.x2,
  },
  qrMatrixBox: {
    width: 140,
    height: 140,
    backgroundColor: '#FFFFFF',
    borderRadius: radii.compact,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    padding: spacing.x2,
  },
  qrCornerTopLeft: {
    position: 'absolute',
    top: 10,
    left: 10,
    width: 28,
    height: 28,
    borderWidth: 4,
    borderColor: '#0F172A',
  },
  qrCornerTopRight: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 28,
    height: 28,
    borderWidth: 4,
    borderColor: '#0F172A',
  },
  qrCornerBottomLeft: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    width: 28,
    height: 28,
    borderWidth: 4,
    borderColor: '#0F172A',
  },
  qrCenterIcon: {
    width: 32,
    height: 32,
    backgroundColor: '#0F172A',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrEmoji: { fontSize: 16 },
  qrPatternSim: { marginTop: 4, alignItems: 'center' },
  qrPatternText: { fontSize: 8, color: '#64748B', letterSpacing: 2 },
  qrCodeLabel: { ...typography.label, color: '#94A3B8', letterSpacing: 2, fontSize: 12 },
  qrInstructions: { ...typography.caption, color: '#CBD5E1', textAlign: 'center', fontSize: 11 },
  refreshQrBtn: {
    minHeight: touchTarget,
    borderRadius: radii.compact,
    backgroundColor: palette.coolWhite,
    borderWidth: 1,
    borderColor: palette.outline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshQrText: { ...typography.label, color: palette.royalBlue, fontWeight: '700' },
  sectionHeader: { marginTop: spacing.x1 },
  sectionTitle: { ...typography.title, fontSize: 17, fontWeight: '800' },
  starCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.card,
    padding: spacing.x4,
    gap: spacing.x3,
  },
  starCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  starCardInfo: { flex: 1, paddingRight: spacing.x2 },
  merchantTitle: { ...typography.headline, fontSize: 16, fontWeight: '800' },
  merchantCat: { ...typography.caption, fontSize: 12, marginTop: 2 },
  starPill: {
    backgroundColor: '#FEF3C7',
    paddingHorizontal: spacing.x2,
    paddingVertical: spacing.x1,
    borderRadius: radii.pill,
  },
  starPillText: { ...typography.caption, color: '#92400E', fontWeight: '800', fontSize: 12 },
  starProgressRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 4 },
  starDot: {
    flex: 1,
    height: 28,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  starDotFilled: { backgroundColor: '#FEF3C7' },
  starDotEmpty: { backgroundColor: '#F1F5F9' },
  starDotIcon: { fontSize: 12 },
  starCardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E2E8F0',
    paddingTop: spacing.x2,
  },
  rewardAvailableTag: {
    backgroundColor: '#D1FAE5',
    paddingHorizontal: spacing.x2,
    paddingVertical: 2,
    borderRadius: 4,
  },
  rewardAvailableText: { ...typography.caption, color: '#065F46', fontWeight: '800' },
  starsLeftText: { ...typography.caption, fontSize: 12 },
  visitStoreLink: { ...typography.label, color: palette.royalBlue, fontWeight: '700', fontSize: 13 },
  infoCard: {
    borderWidth: 1,
    borderRadius: radii.compact,
    padding: spacing.x4,
    gap: spacing.x2,
  },
  infoTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.x2 },
  infoTitle: { ...typography.title, fontSize: 15, fontWeight: '800', color: palette.ink },
  infoBody: { ...typography.caption, fontSize: 12, lineHeight: 18 },
});