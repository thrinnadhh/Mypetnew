import { StyleSheet } from 'react-native'
import { accessibility, colors, radii, spacing } from '@mypet/design-tokens'

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, padding: spacing.lg, gap: spacing.md },
  title: { color: colors.text, fontSize: 28, fontWeight: '800' },
  subtitle: { color: colors.mutedText, fontSize: 16, lineHeight: 24 },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, padding: spacing.md, gap: spacing.sm },
  button: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: radii.md, justifyContent: 'center', minHeight: accessibility.minimumTouchTarget, paddingHorizontal: spacing.md },
  buttonText: { color: colors.primaryContrast, fontSize: 16, fontWeight: '700' },
  secondaryButton: { alignItems: 'center', borderColor: colors.primary, borderRadius: radii.md, borderWidth: 1, justifyContent: 'center', minHeight: accessibility.minimumTouchTarget, paddingHorizontal: spacing.md },
  input: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.sm, borderWidth: 1, color: colors.text, fontSize: 16, minHeight: accessibility.minimumTouchTarget, paddingHorizontal: spacing.md },
  status: { color: colors.mutedText, fontSize: 15 },
  error: { color: colors.danger, fontSize: 15 },
  camera: { flex: 1, minHeight: 320, borderRadius: radii.md, overflow: 'hidden' }
})

