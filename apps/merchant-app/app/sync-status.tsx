import { Link } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { loadOfflineMerchantAccountId } from '../src/auth/offline-account';
import { fetchMerchantCatalogContext } from '../src/catalog/api';
import { useMerchantDatabase } from '../src/data';
import type { OfflineCommandRecord } from '../src/data/models/outbox-types';
import type { MerchantPartitionContext } from '../src/data/models/partition-context';
import { createPartitionContext } from '../src/data/models/partition-context';
import { PartitionDiscoveryRepository } from '../src/data/repositories/partition-discovery-repository';
import { summarizeOperationalSync, type OperationalSyncSummary } from '../src/operations/sync-summary';
import { SyncCoordinator } from '../src/sync';

type Attention = { outletId: string; command: OfflineCommandRecord };
const MAX_OPERATIONAL_PARTITIONS = 100;

export default function MerchantSyncStatusScreen() {
  const { database, outboxRepo, syncStateRepo } = useMerchantDatabase();
  const [partitions, setPartitions] = useState<MerchantPartitionContext[]>([]);
  const [summary, setSummary] = useState<OperationalSyncSummary>();
  const [attention, setAttention] = useState<Attention[]>([]);
  const [message, setMessage] = useState('');
  const [canonicalContext, setCanonicalContext] = useState(false);
  const [busy, setBusy] = useState(false);
  const discovery = useMemo(() => database ? new PartitionDiscoveryRepository(database) : null, [database]);

  const load = useCallback(async () => {
    if (!database || !outboxRepo || !syncStateRepo || !discovery) return;
    setBusy(true);
    setMessage('');
    try {
      const accountId = await loadOfflineMerchantAccountId();
      if (!accountId) { setPartitions([]); setSummary(undefined); setAttention([]); setCanonicalContext(false); setMessage('No durable Merchant account is available on this device.'); return; }
      let resolved: MerchantPartitionContext[] = [];
      try {
        const context = await fetchMerchantCatalogContext();
        if (context.organizationId) resolved = context.outletIds.map((outletId) => createPartitionContext(accountId, context.organizationId!, outletId));
        setCanonicalContext(true);
      } catch {
        resolved = await discovery.listKnownPartitionsForAccount(accountId);
        setCanonicalContext(false);
        setMessage('Server context is unavailable. Showing durable local sync state only; it is not canonical business state.');
      }
      if (resolved.length > MAX_OPERATIONAL_PARTITIONS) {
        resolved = resolved.slice(0, MAX_OPERATIONAL_PARTITIONS);
        setCanonicalContext(false);
        setMessage('Operational partition scope exceeds 100 outlets. Showing a bounded local subset; select an outlet online for canonical work.');
      }
      setPartitions(resolved);
      setSummary(await summarizeOperationalSync(resolved, syncStateRepo, outboxRepo));
      const rows: Attention[] = [];
      for (const partition of resolved) {
        for (const command of await outboxRepo.listOperationalAttention(partition, 50)) rows.push({ outletId: partition.outletId, command });
      }
      setAttention(rows.slice(0, 100));
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Sync status unavailable.'); }
    finally { setBusy(false); }
  }, [database, discovery, outboxRepo, syncStateRepo]);

  useEffect(() => { const task = setTimeout(() => void load(), 0); return () => clearTimeout(task); }, [load]);

  async function syncNow() {
    if (!database || partitions.length === 0 || busy) return;
    setBusy(true); setMessage('');
    try {
      const coordinator = new SyncCoordinator(database);
      for (const partition of partitions) await coordinator.sync(partition);
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Sync failed safely.'); setBusy(false); }
  }

  async function retry(item: Attention) {
    if (!database || !outboxRepo || busy) return;
    const partition = partitions.find((p) => p.outletId === item.outletId);
    if (!partition) return;
    setBusy(true); setMessage('');
    try {
      await outboxRepo.requestManualRetry(partition, item.command.commandId);
      await new SyncCoordinator(database).sync(partition);
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Retry is not permitted.'); setBusy(false); }
  }

  return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={styles.content}>
    <View style={styles.header}><View style={{ flex: 1 }}><Text style={styles.title}>Sync & conflicts</Text><Text style={styles.muted}>Connectivity, durable command state, and canonical business state are deliberately separate.</Text></View><Link href="/dashboard" style={styles.link}>Dashboard</Link></View>
    {message ? <Text accessibilityRole="alert" style={styles.notice}>{message}</Text> : null}
    <View style={styles.card}><Text style={styles.heading}>{canonicalContext ? 'Canonical outlet context available' : 'Local-only context'}</Text><Text>Pending {summary?.commands.pending ?? 0} · Sending {summary?.commands.sending ?? 0} · Retry {summary?.commands.retry ?? 0}</Text><Text>Reconcile {summary?.commands.reconciliation ?? 0} · Rejected {summary?.commands.rejected ?? 0} · Blocked {summary?.commands.blocked ?? 0}</Text><Text>Acknowledged {summary?.commands.acknowledged ?? 0}</Text></View>
    <Button title="Run safe sync" onPress={() => void syncNow()} disabled={busy || partitions.length === 0} />
    <Text style={styles.section}>Needs attention</Text>
    {attention.length === 0 ? <Text style={styles.muted}>No retry, conflict, rejected, or blocked commands.</Text> : attention.map((item) => <View key={`${item.outletId}:${item.command.commandId}`} style={styles.card}><Text style={styles.heading}>{item.command.commandType} · {item.command.state}</Text><Text style={styles.muted}>{item.command.lastErrorCode ?? 'No error code'} · attempts {item.command.attemptCount}</Text>{item.command.nextAttemptAt ? <Text style={styles.muted}>Retry after {new Date(item.command.nextAttemptAt).toLocaleString('en-IN')}</Text> : null}{item.command.state === 'RETRYABLE' ? <Pressable accessibilityRole="button" disabled={busy} onPress={() => void retry(item)} style={styles.retry}><Text style={styles.retryText}>Retry same durable command</Text></Pressable> : <Text>{item.command.state === 'NEEDS_RECONCILIATION' ? 'Refresh canonical state before creating any replacement operation.' : item.command.state === 'BLOCKED' ? 'Resolve the rejected/blocked parent operation first.' : 'Permanent rejection; reopen the workflow using current canonical values.'}</Text>}</View>)}
    <Text style={styles.section}>Projection freshness</Text>
    {summary?.projections.map((p) => <View key={`${p.outletId}:${p.projection}`} style={styles.row}><Text style={styles.heading}>{p.projection}</Text><Text>{p.freshness}</Text></View>)}
    {busy ? <Text>Updating operational sync state…</Text> : null}
  </ScrollView></SafeAreaView>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f8fafc' }, content: { padding: 20, gap: 14, paddingBottom: 48 }, header: { flexDirection: 'row', gap: 12 },
  title: { fontSize: 28, fontWeight: '900', color: '#0f172a' }, muted: { color: '#64748b', lineHeight: 20 }, link: { color: '#2563eb', fontWeight: '700' },
  notice: { padding: 12, borderRadius: 12, backgroundColor: '#fff7ed' }, card: { padding: 16, borderRadius: 16, backgroundColor: '#fff', gap: 7 }, heading: { fontWeight: '800', color: '#0f172a' }, section: { fontSize: 18, fontWeight: '900', marginTop: 6 },
  retry: { minHeight: 44, paddingHorizontal: 12, justifyContent: 'center', borderRadius: 10, backgroundColor: '#dbeafe' }, retryText: { color: '#1d4ed8', fontWeight: '800' }, row: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#fff', padding: 12, borderRadius: 10 },
});
