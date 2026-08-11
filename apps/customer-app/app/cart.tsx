import { Text, View } from 'react-native'
import { styles } from '../src/styles'

export default function CartScreen() {
  return (
    <View style={styles.screen}>
      <Text accessibilityRole="header" style={styles.title}>One merchant per cart</Text>
      <Text style={styles.subtitle}>Your cart is empty. Adding an item from another outlet will always ask before replacing this cart.</Text>
    </View>
  )
}

