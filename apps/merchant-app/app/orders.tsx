import { Link } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Button, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  fetchMerchantOrderWork,
  orderTargets,
  transitionMerchantOrder,
  type MerchantOrderStatus,
  type MerchantOrderWorkItem,
} from '../src/operations/orders';

function money(paise: number): string { return `₹${(paise / 100).toFixed(2)}`; }
function label(target: MerchantOrderStatus): string { return target.replaceAll('_', ' ').toLowerCase(); }

export default function MerchantOrdersScreen() {
  const [items, setItems] = useState<MerchantOrderWorkItem[]>([]);
  const [message, setMessage] = useState('');
  const [busyId, setBusyId] = useState<string>();
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setMessage('');
    try { setItems((await fetchMerchantOrderWork()).items); }
    catch (error) { setItems([]); setMessage(error instanceof Error ? error.message : 'Order work unavailable.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const task = setTimeout(() => void load(), 0);
    return () => clearTimeout(task);
  }, [load]);

  async function transition(order: MerchantOrderWorkItem, target: MerchantOrderStatus) {
    if (busyId) return;
    const destructive = target === 'REJECTED' || target === 'CANCELLED';
    if (destructive && !reason.trim()) { setMessage('Enter a reason before rejecting or cancelling an order.'); return; }
    setBusyId(order.orderId);
    setMessage('');
    try {
      await transitionMerchantOrder(order, target, destructive ? reason : undefined);
      setReason('');
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Order update failed.');
    } finally { setBusyId(undefined); }
  }

  return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={styles.content}>
    <View style={styles.header}><View style={styles.flex}><Text style={styles.title}>Order work</Text><Text style={styles.muted}>Canonical server workload. Every transition is reauthorized and idempotent.</Text></View><Link href="/dashboard" style={styles.link}>Dashboard</Link></View>
    {message ? <Text accessibilityRole="alert" style={styles.notice}>{message}</Text> : null}
    <TextInput accessibilityLabel="Reason for rejecting or cancelling an order" value={reason} onChangeText={setReason} placeholder="Reason for reject/cancel" maxLength={240} style={styles.input} />
    {loading ? <Text>Loading canonical order work…</Text> : null}
    {!loading && items.length === 0 ? <View style={styles.card}><Text style={styles.heading}>No active order work</Text><Text style={styles.muted}>Placed and in-progress orders will appear here.</Text></View> : null}
    {items.map((order) => <View key={order.orderId} style={styles.card}>
      <Text style={styles.heading}>{order.orderNumber}</Text>
      <Text>{order.status.replaceAll('_', ' ')} · {order.fulfilmentMode.replaceAll('_', ' ')}</Text>
      <Text>{money(order.grandTotalPaise)} · {order.paymentStatus.replaceAll('_', ' ')}</Text>
      <Text style={styles.muted}>{new Date(order.createdAt).toLocaleString('en-IN')}</Text>
      <View style={styles.actions}>{orderTargets(order).map((target) => <Pressable key={target} accessibilityRole="button" disabled={Boolean(busyId)} onPress={() => void transition(order, target)} style={styles.action}><Text style={styles.actionText}>{busyId === order.orderId ? 'Updating…' : label(target)}</Text></Pressable>)}</View>
    </View>)}
    <Button title="Refresh order work" onPress={() => void load()} disabled={loading || Boolean(busyId)} />
  </ScrollView></SafeAreaView>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f8fafc' }, content: { padding: 20, gap: 14, paddingBottom: 48 },
  header: { flexDirection: 'row', gap: 12 }, flex: { flex: 1 }, title: { fontSize: 28, fontWeight: '900', color: '#0f172a' },
  muted: { color: '#64748b', lineHeight: 20 }, link: { color: '#2563eb', fontWeight: '700' }, notice: { padding: 12, backgroundColor: '#fff7ed', borderRadius: 12 },
  input: { minHeight: 48, backgroundColor: '#fff', borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 12, paddingHorizontal: 12 },
  card: { backgroundColor: '#fff', padding: 16, borderRadius: 16, gap: 7 }, heading: { fontSize: 17, fontWeight: '800', color: '#0f172a' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, action: { minHeight: 44, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 10, backgroundColor: '#dbeafe' }, actionText: { color: '#1d4ed8', fontWeight: '800', textTransform: 'capitalize' },
});
