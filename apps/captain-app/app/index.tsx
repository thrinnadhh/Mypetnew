import { Link } from 'expo-router'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { accessibility, colors, radii, spacing } from '@mypet/design-tokens'

export default function CaptainHome() {
  return (
    <View style={styles.screen}>
      <Text accessibilityRole="header" style={styles.title}>Captain shell ready</Text>
      <Text style={styles.copy}>Sprint 1 establishes isolated identity, secure notification registration, protected deep links, and no cross-role data. Dispatch begins in Sprint 4.</Text>
      <Link href="/inbox" asChild><Pressable accessibilityRole="button" style={styles.button}><Text style={styles.buttonText}>Notification inbox</Text></Pressable></Link>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, padding: spacing.lg, gap: spacing.md },
  title: { color: colors.text, fontSize: 28, fontWeight: '800' },
  copy: { color: colors.mutedText, fontSize: 16, lineHeight: 24 },
  button: { alignItems: 'center', backgroundColor: colors.primary, borderRadius: radii.md, justifyContent: 'center', minHeight: accessibility.minimumTouchTarget },
  buttonText: { color: colors.primaryContrast, fontSize: 16, fontWeight: '700' }
})

