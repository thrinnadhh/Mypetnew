import { Text, View } from 'react-native'
import { styles } from '../src/styles'

export default function InboxScreen() {
  return <View style={styles.screen}><Text accessibilityRole="header" style={styles.title}>Notifications</Text><Text style={styles.subtitle}>New-order alerts remain in this inbox even when native push is delayed or denied.</Text></View>
}

