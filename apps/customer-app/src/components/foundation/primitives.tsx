import type { ReactNode } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppIcon, type AppIconName } from '@/components/app-icon';
import { ThemedText } from '@/components/themed-text';
import { radii, shadows, spacing, touchTarget, typography } from '@/design/tokens';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useTheme } from '@/hooks/use-theme';

export function AppBar({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <View style={styles.appBar} accessibilityRole="header">
      <View style={styles.flex}>
        <ThemedText style={styles.title} maxFontSizeMultiplier={1.5}>{title}</ThemedText>
        {subtitle ? <ThemedText type="small" themeColor="textSecondary" maxFontSizeMultiplier={1.6}>{subtitle}</ThemedText> : null}
      </View>
      {action}
    </View>
  );
}

export function LocationHeader({ label, location }: { label: string; location: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.location, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <AppIcon name="location" color={theme.primary} size={20} />
      <View style={styles.flex}>
        <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>
        <ThemedText style={styles.locationText} numberOfLines={1}>{location}</ThemedText>
      </View>
    </View>
  );
}

export function SearchField(props: { value: string; onChangeText: (value: string) => void; placeholder: string; onSubmit?: () => void; onPress?: () => void; editable?: boolean }) {
  const theme = useTheme();
  return (
    <View style={[styles.search, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}>
      <AppIcon name="search" color={theme.textSecondary} size={18} />
      <TextInput
        value={props.value}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        placeholderTextColor={theme.textSecondary}
        style={[styles.searchInput, { color: theme.text }]}
        returnKeyType="search"
        onSubmitEditing={props.onSubmit}
        onPressIn={props.onPress}
        editable={props.editable ?? true}
        accessibilityRole={props.onPress && props.editable === false ? 'button' : undefined}
        accessibilityLabel={props.placeholder}
        maxFontSizeMultiplier={1.6}
      />
    </View>
  );
}

export function FilterChip({ label, selected, onPress }: { label: string; selected?: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [styles.chip, { backgroundColor: selected ? theme.primarySoft : theme.backgroundElement, borderColor: selected ? theme.primary : theme.border }, pressed && styles.pressed]}
    >
      <ThemedText type="small" style={{ color: selected ? theme.primary : theme.text, fontWeight: '700' }}>{label}</ThemedText>
    </Pressable>
  );
}

export function SectionHeader({ title, actionLabel, onAction }: { title: string; actionLabel?: string; onAction?: () => void }) {
  const theme = useTheme();
  return (
    <View style={styles.sectionHeader}>
      <ThemedText style={styles.sectionTitle}>{title}</ThemedText>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} accessibilityRole="button" style={styles.textAction}>
          <ThemedText type="small" style={{ color: theme.primary, fontWeight: '700' }}>{actionLabel}</ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

export function EntityCard({ title, subtitle, meta, icon = 'paw', badge, onPress }: { title: string; subtitle: string; meta?: string; icon?: AppIconName; badge?: string; onPress?: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${title}. ${subtitle}`}
      style={({ pressed }) => [styles.card, shadows.card, { backgroundColor: theme.backgroundElement, borderColor: theme.border }, pressed && styles.pressed]}
    >
      <View style={[styles.cardIcon, { backgroundColor: theme.primarySoft }]}><AppIcon name={icon} color={theme.primary} size={24} /></View>
      <View style={styles.flex}>
        <View style={styles.sectionHeader}>
          <ThemedText style={styles.cardTitle} numberOfLines={2}>{title}</ThemedText>
          {badge ? <StatusBadge label={badge} tone="success" /> : null}
        </View>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>{subtitle}</ThemedText>
        {meta ? <ThemedText type="small" style={{ color: theme.primary, fontWeight: '700' }}>{meta}</ThemedText> : null}
      </View>
    </Pressable>
  );
}

export function StatusBadge({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'success' | 'warning' | 'error' }) {
  const theme = useTheme();
  const colors = tone === 'success'
    ? [theme.successSoft, theme.success]
    : tone === 'warning'
      ? [theme.primarySoft, theme.warning]
      : tone === 'error'
        ? [theme.errorSoft, theme.danger]
        : [theme.muted, theme.textSecondary];
  return <View style={[styles.badge, { backgroundColor: colors[0] }]}><ThemedText type="small" style={{ color: colors[1], fontWeight: '700' }}>{label}</ThemedText></View>;
}

export function TenStarProgress({ earned, label }: { earned: number; label: string }) {
  const theme = useTheme();
  const count = Math.max(0, Math.min(10, Math.round(earned)));
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 0, max: 10, now: count }}>
      <View style={styles.starRow}>{Array.from({ length: 10 }, (_, index) => <AppIcon key={index} name="star" size={20} color={index < count ? theme.accent : theme.border} />)}</View>
      <ThemedText type="small" themeColor="textSecondary">{label}</ThemedText>
    </View>
  );
}

export type StateKind = 'loading' | 'empty' | 'error' | 'offline' | 'unauthenticated';
export function StateView({ kind, title, message, actionLabel, onAction }: { kind: StateKind; title: string; message?: string; actionLabel?: string; onAction?: () => void }) {
  const theme = useTheme();
  const icon: AppIconName = kind === 'offline' ? 'offline' : kind === 'error' ? 'warning' : kind === 'unauthenticated' ? 'shield' : kind === 'empty' ? 'search' : 'sparkle';
  return (
    <View style={styles.state} accessibilityLiveRegion="polite">
      {kind === 'loading' ? <ActivityIndicator size="large" color={theme.primary} /> : <View style={[styles.stateIcon, { backgroundColor: theme.primarySoft }]}><AppIcon name={icon} color={theme.primary} size={28} /></View>}
      <ThemedText style={styles.sectionTitle}>{title}</ThemedText>
      {message ? <ThemedText type="small" themeColor="textSecondary" style={styles.center}>{message}</ThemedText> : null}
      {actionLabel && onAction ? <PrimaryAction label={actionLabel} onPress={onAction} /> : null}
    </View>
  );
}

export function PrimaryAction({ label, onPress, disabled, loading }: { label: string; onPress: () => void; disabled?: boolean; loading?: boolean }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      style={({ pressed }) => [styles.primaryAction, { backgroundColor: theme.cta }, (disabled || loading) && styles.disabled, pressed && styles.pressed]}
    >
      {loading ? <ActivityIndicator color="#FFFFFF" /> : <ThemedText style={styles.primaryActionText}>{label}</ThemedText>}
    </Pressable>
  );
}

export function StickyCta({ label, onPress, disabled, loading }: { label: string; onPress: () => void; disabled?: boolean; loading?: boolean }) {
  const theme = useTheme();
  return <View style={[styles.sticky, shadows.raised, { backgroundColor: theme.backgroundElement, borderColor: theme.border }]}><PrimaryAction label={label} onPress={onPress} disabled={disabled} loading={loading} /></View>;
}

export function BottomSheet({ visible, title, onClose, children }: { visible: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  return (
    <Modal visible={visible} transparent animationType={reducedMotion ? "none" : "slide"} onRequestClose={onClose} accessibilityViewIsModal>
      <Pressable style={styles.overlay} onPress={onClose} accessibilityLabel={title}>
        <Pressable style={[styles.sheet, shadows.raised, { backgroundColor: theme.backgroundElement }]}>
          <View style={[styles.handle, { backgroundColor: theme.border }]} />
          <SectionHeader title={title} />
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function SkeletonBlock({ height = 96 }: { height?: number }) {
  const theme = useTheme();
  return <View accessibilityLabel="Loading" style={[styles.skeleton, { height, backgroundColor: theme.muted, borderColor: theme.border }]} />;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  appBar: { minHeight: 64, paddingHorizontal: spacing.x4, paddingVertical: spacing.x2, flexDirection: 'row', alignItems: 'center', gap: spacing.x3 },
  title: { ...typography.headline },
  location: { minHeight: touchTarget, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.card, padding: spacing.x3, flexDirection: 'row', alignItems: 'center', gap: spacing.x3 },
  locationText: { ...typography.label },
  search: { minHeight: touchTarget, borderWidth: 1, borderRadius: radii.compact, paddingHorizontal: spacing.x3, flexDirection: 'row', alignItems: 'center', gap: spacing.x2 },
  searchInput: { flex: 1, minHeight: touchTarget, ...typography.body, paddingVertical: 0 },
  chip: { minHeight: 44, borderWidth: 1, borderRadius: radii.pill, paddingHorizontal: spacing.x4, alignItems: 'center', justifyContent: 'center' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.x2 },
  sectionTitle: { ...typography.title },
  textAction: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.x2 },
  card: { minHeight: 104, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.card, padding: spacing.x4, flexDirection: 'row', gap: spacing.x3 },
  cardIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { ...typography.label, flexShrink: 1 },
  badge: { borderRadius: radii.pill, paddingHorizontal: spacing.x2, paddingVertical: spacing.x1 },
  starRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.x1, marginBottom: spacing.x2 },
  state: { flex: 1, minHeight: 280, alignItems: 'center', justifyContent: 'center', gap: spacing.x3, padding: spacing.x6 },
  stateIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  center: { textAlign: 'center', maxWidth: 420 },
  primaryAction: { minHeight: touchTarget, borderRadius: radii.compact, paddingHorizontal: spacing.x6, alignItems: 'center', justifyContent: 'center' },
  primaryActionText: { color: '#FFFFFF', ...typography.label },
  disabled: { opacity: 0.55 },
  pressed: { opacity: 0.82 },
  sticky: { borderTopWidth: StyleSheet.hairlineWidth, padding: spacing.x4 },
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(11, 28, 48, 0.45)' },
  sheet: { borderTopLeftRadius: radii.feature, borderTopRightRadius: radii.feature, padding: spacing.x4, gap: spacing.x4, maxHeight: '88%' },
  handle: { width: 44, height: 4, borderRadius: 2, alignSelf: 'center' },
  skeleton: { borderRadius: radii.card, borderWidth: StyleSheet.hairlineWidth, opacity: 0.7 },
});
