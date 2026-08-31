import { Link, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Button, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { loadOfflineMerchantAccountId } from '../src/auth/offline-account';
import { fetchMerchantCatalogContext, type MerchantCatalogContext } from '../src/catalog/api';
import { useMerchantDatabase } from '../src/data';
import { createPartitionContext } from '../src/data/models/partition-context';
import {
  dashboardCards,
  fetchMerchantDashboard,
  type MerchantDashboardSnapshot,
} from '../src/operations/dashboard';
import { canManageStaff } from '../src/operations/staff';
import { summarizeOperationalSync, type OperationalSyncSummary } from '../src/operations/sync-summary';

type DashboardContentProps = { showHomeLink?: boolean };

export function MerchantDashboardContent({ showHomeLink = true }: DashboardContentProps) {
  const { outboxRepo, syncStateRepo } = useMerchantDatabase();
  const [merchantContext, setMerchantContext] = useState<MerchantCatalogContext>();
  const [outletId, setOutletId] = useState<string>();
  const [dashboard, setDashboard] = useState<MerchantDashboardSnapshot>();
  const [sync, setSync] = useState<OperationalSyncSummary>();
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [syncMessage, setSyncMessage] = useState('');

  const load = useCallback(async (context: MerchantCatalogContext, selectedOutlet?: string) => {
    setLoading(true);
    setMessage('');
    setSyncMessage('');
    try {
      const canonical = await fetchMerchantDashboard(selectedOutlet);
      setDashboard(canonical);

      try {
        if (!outboxRepo || !syncStateRepo || !context.organizationId) {
          setSync(undefined);
          return;
        }
        const accountId = await loadOfflineMerchantAccountId();
        if (!accountId) {
          setSync(undefined);
          return;
        }
        const organizationId = context.organizationId;
        const outletIds = selectedOutlet ? [selectedOutlet] : canonical.outletIds;
        const partitions = outletIds.map((id) => createPartitionContext(accountId, organizationId, id));
        setSync(await summarizeOperationalSync(partitions, syncStateRepo, outboxRepo));
      } catch {
        setSync(undefined);
        setSyncMessage('Local sync health could not be read from this device.');
      }
    } catch (error) {
      setDashboard(undefined);
      setSync(undefined);
      setMessage(error instanceof Error ? error.message : 'Dashboard unavailable.');
    } finally {
      setLoading(false);
    }
  }, [outboxRepo, syncStateRepo]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const context = await fetchMerchantCatalogContext();
        if (!active) return;
        setMerchantContext(context);
        await load(context);
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : 'Dashboard unavailable.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [load]);

  const cards = useMemo(() => dashboard ? dashboardCards(dashboard) : [], [dashboard]);
  const staffOutletId = outletId
    ? (canManageStaff(merchantContext?.permissionsByOutlet[outletId] ?? []) ? outletId : undefined)
    : merchantContext?.outletIds.find((id) => canManageStaff(merchantContext.permissionsByOutlet[id] ?? []));

  function selectOutlet(selected?: string) {
    if (!merchantContext || loading) return;
    setOutletId(selected);
    void load(merchantContext, selected);
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View style={styles.flex}>
          <Text style={styles.title}>Operations dashboard</Text>
          <Text style={styles.muted}>Business metrics are canonical server values. Sync health is local to this device.</Text>
        </View>
        {showHomeLink ? <Link href="/" style={styles.link}>Home</Link> : null}
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.outlets}>
          <Pressable
            accessibilityRole="button"
            onPress={() => selectOutlet()}
            style={[styles.pill, outletId === undefined && styles.pillSelected]}
          ><Text style={outletId === undefined ? styles.pillSelectedText : styles.pillText}>All outlets</Text></Pressable>
          {merchantContext?.outletIds.map((id, index) => (
            <Pressable
              key={id}
              accessibilityRole="button"
              onPress={() => selectOutlet(id)}
              style={[styles.pill, id === outletId && styles.pillSelected]}
            ><Text style={id === outletId ? styles.pillSelectedText : styles.pillText}>Outlet {index + 1}</Text></Pressable>
          ))}
        </View>

        {loading ? <ActivityIndicator accessibilityLabel="Loading dashboard" /> : null}
        {message ? (
          <View style={styles.panel}>
            <Text accessibilityRole="alert">{message}</Text>
            <Button title="Retry" onPress={() => merchantContext ? void load(merchantContext, outletId) : undefined} />
          </View>
        ) : null}

        {dashboard ? (
          <>
            <Text style={styles.generated}>Updated {new Date(dashboard.generatedAt).toLocaleString('en-IN')}</Text>
            <View style={styles.grid}>
              {cards.map((card) => (
                <View key={card.key} style={styles.card}>
                  <Text style={styles.metric}>{card.value}</Text>
                  <Text style={styles.cardTitle}>{card.label}</Text>
                  <Text style={styles.muted}>{card.detail}</Text>
                  <Link href={card.destination as Href} style={styles.link}>Open</Link>
                </View>
              ))}
            </View>
          </>
        ) : null}

        <View style={styles.panel}>
          <Text style={styles.section}>Device sync & conflicts</Text>
          {sync ? (
            <>
              <Text>Pending {sync.commands.pending} · Sending {sync.commands.sending} · Retry {sync.commands.retry}</Text>
              <Text>Reconcile {sync.commands.reconciliation} · Rejected {sync.commands.rejected} · Blocked {sync.commands.blocked}</Text>
              <Text>Acknowledged {sync.commands.acknowledged}</Text>
              {sync.projections.map((projection) => (
                <Text key={`${projection.outletId}-${projection.projection}`} style={styles.muted}>
                  {projection.projection}: {projection.freshness}
                </Text>
              ))}
            </>
          ) : <Text style={styles.muted}>{syncMessage || 'Local sync status is unavailable until this device has an active stored Merchant account.'}</Text>}
        </View>

        <View style={styles.actions}>
          <Link href="/sync-status" style={styles.actionLink}>Sync & conflict status</Link>
          <Link href="/orders" style={styles.actionLink}>Order work</Link>
          <Link href="/notifications" style={styles.actionLink}>Notification inbox</Link>
          {staffOutletId ? (
            <Link href={{ pathname: '/staff', params: { outletId: staffOutletId } }} style={styles.actionLink}>
              Manage staff
            </Link>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

export default function MerchantDashboardScreen() {
  return <SafeAreaView style={styles.page}><MerchantDashboardContent /></SafeAreaView>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f8fafc' },
  screen: { flex: 1, backgroundColor: '#f8fafc' },
  header: { flexDirection: 'row', gap: 12, padding: 20, alignItems: 'flex-start' },
  flex: { flex: 1 },
  title: { fontSize: 26, fontWeight: '800', color: '#0f172a' },
  muted: { color: '#64748b', lineHeight: 20 },
  generated: { color: '#64748b', fontSize: 12 },
  link: { color: '#2563eb', fontWeight: '700' },
  content: { padding: 20, paddingTop: 0, gap: 16, paddingBottom: 48 },
  outlets: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: '#e2e8f0' },
  pillSelected: { backgroundColor: '#0f766e' },
  pillText: { color: '#334155' },
  pillSelectedText: { color: '#fff', fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  card: { width: '47%', minWidth: 150, padding: 16, borderRadius: 16, backgroundColor: '#fff', gap: 6 },
  metric: { fontSize: 30, fontWeight: '800', color: '#0f766e' },
  cardTitle: { fontWeight: '700', color: '#0f172a' },
  panel: { padding: 16, borderRadius: 16, backgroundColor: '#fff', gap: 8 },
  section: { fontSize: 18, fontWeight: '800' },
  actions: { gap: 10 },
  actionLink: { padding: 16, borderRadius: 12, backgroundColor: '#dbeafe', color: '#1d4ed8', fontWeight: '800' },
});
