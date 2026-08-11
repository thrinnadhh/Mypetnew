import { Text, View } from 'react-native'
import { styles } from '../src/styles'

export default function InboxScreen() {
  return <View style={styles.screen}><Text accessibilityRole="header" style={styles.title}>Notifications</Text><Text style={styles.subtitle}>Your in-app notifications remain available even when push is disabled.</Text></View>
}

