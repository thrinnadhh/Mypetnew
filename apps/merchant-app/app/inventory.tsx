import { Text, View } from 'react-native'
import { styles } from '../src/styles'

export default function InventoryScreen() {
  return <View style={styles.screen}><Text accessibilityRole="header" style={styles.title}>Inventory ledger</Text><Text style={styles.subtitle}>Receive stock, preview count variance, and submit one idempotent adjustment batch. Current stock is always reloaded from the API.</Text></View>
}

