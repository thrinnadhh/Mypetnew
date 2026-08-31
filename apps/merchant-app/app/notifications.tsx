import { Link, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Button, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  fetchMerchantNotifications,
  notificationDestination,
  type MerchantNotification,
} from '../src/operations/notifications';

export default function MerchantNotificationsScreen() {
  const router = useRouter();
  const [items, setItems] = useState<MerchantNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setMessage('');
    try { setItems((await fetchMerchantNotifications()).items); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Notifications unavailable.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const startup = setTimeout(() => void load(), 0);
    return () => clearTimeout(startup);
  }, [load]);

  return (
    <SafeAreaView style={styles.page}>
      <View style={styles.header}><Text style={styles.title}>Notifications</Text><Link href="/dashboard" style={styles.link}>Dashboard</Link></View>
      <ScrollView contentContainerStyle={styles.content}>
        {loading ? <ActivityIndicator /> : null}
        {message ? <View style={styles.panel}><Text accessibilityRole="alert">{message}</Text><Button title="Retry" onPress={() => void load()} /></View> : null}
        {!loading && !message && items.length === 0 ? <View style={styles.panel}><Text>No notifications yet.</Text></View> : null}
        {items.map((item) => (
          <Pressable key={item.id} accessibilityRole="button" onPress={() => router.push(notificationDestination(item))} style={styles.panel}>
            <Text style={styles.itemTitle}>{item.title}</Text><Text>{item.body}</Text><Text style={styles.time}>{new Date(item.createdAt).toLocaleString('en-IN')}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f8fafc' }, header: { flexDirection: 'row', justifyContent: 'space-between', padding: 20 },
  title: { fontSize: 26, fontWeight: '800' }, link: { color: '#2563eb', fontWeight: '700' }, content: { padding: 20, paddingTop: 0, gap: 12 },
  panel: { backgroundColor: '#fff', padding: 16, borderRadius: 16, gap: 7 }, itemTitle: { fontSize: 17, fontWeight: '800' }, time: { color: '#64748b', fontSize: 12 },
});
