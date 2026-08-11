import { Text, View } from 'react-native'
import { styles } from '../src/styles'

export default function OrdersScreen() {
  return <View style={styles.screen}><Text accessibilityRole="header" style={styles.title}>Pickup orders</Text><Text style={styles.subtitle}>Only server-authorized transitions appear here: placed, accepted, preparing, ready, and completed pickup.</Text></View>
}

