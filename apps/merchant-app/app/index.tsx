import { Link } from "expo-router";
import { SafeAreaView, StyleSheet, Text } from "react-native";

export default function MerchantEntryScreen() {
  return (
    <SafeAreaView style={styles.page}>
      <Text style={styles.title}>MyPet Merchant</Text>
      <Text style={styles.body}>Sign in with your verified mobile number to continue.</Text>
      <Link href="/login" accessibilityRole="button">Sign in</Link>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, padding: 24, justifyContent: "center", alignItems: "center", gap: 16, backgroundColor: "#fff" },
  title: { fontSize: 26, fontWeight: "700" },
  body: { fontSize: 16, color: "#4b5563", textAlign: "center" }
});
