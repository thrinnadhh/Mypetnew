import { Text, View } from 'react-native'
import { styles } from '../src/styles'

export default function PosScreen() {
  return <View style={styles.screen}><Text accessibilityRole="header" style={styles.title}>Point of sale</Text><Text style={styles.subtitle}>Scan live outlet stock. Customer loyalty requires a short-lived consent challenge; typed phone numbers never grant access.</Text></View>
}

