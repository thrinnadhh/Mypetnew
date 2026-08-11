import { Link } from 'expo-router'
import { Pressable, ScrollView, Text } from 'react-native'
import { styles } from '../src/styles'

const actions = [
  ['/scanner', 'Scan product'],
  ['/inventory', 'Inventory'],
  ['/pos', 'POS sale'],
  ['/orders', 'Pickup orders'],
  ['/inbox', 'Notifications']
] as const

export default function MerchantHome() {
  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Text accessibilityRole="header" style={styles.title}>Outlet operations</Text>
      <Text style={styles.subtitle}>Live catalog, stock, orders, POS, and merchant-specific loyalty use the server as their only authority.</Text>
      {actions.map(([href, label]) => (
        <Link href={href} asChild key={href}>
          <Pressable accessibilityRole="button" style={styles.button}><Text style={styles.buttonText}>{label}</Text></Pressable>
        </Link>
      ))}
    </ScrollView>
  )
}

