import { StyleSheet, Text, View } from 'react-native'
import { colors, spacing } from '@mypet/design-tokens'

export default function InboxScreen() {
  return <View style={styles.screen}><Text accessibilityRole="header" style={styles.title}>Notifications</Text><Text style={styles.copy}>Only safe, allowlisted Captain routes can open from native push.</Text></View>
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, padding: spacing.lg, gap: spacing.md },
  title: { color: colors.text, fontSize: 28, fontWeight: '800' },
  copy: { color: colors.mutedText, fontSize: 16, lineHeight: 24 }
})

