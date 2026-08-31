import { Link, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { fetchMerchantCatalogContext } from '../src/catalog/api';
import {
  canManagePermission,
  canManageStaff,
  fetchStaffGrants,
  grantStaffPermission,
  revokeStaffPermission,
  STAFF_PERMISSIONS,
  type MerchantPermission,
  type MerchantStaffGrant,
} from '../src/operations/staff';

export default function MerchantStaffScreen() {
  const params = useLocalSearchParams<{ outletId?: string }>();
  const [outletId, setOutletId] = useState<string>();
  const [actorPermissions, setActorPermissions] = useState<string[]>([]);
  const [items, setItems] = useState<MerchantStaffGrant[]>([]);
  const [accountId, setAccountId] = useState('');
  const [permission, setPermission] = useState<MerchantPermission>('CATALOG_WRITE');
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');
  const canManage = canManageStaff(actorPermissions);
  const assignable = useMemo(
    () => STAFF_PERMISSIONS.filter((candidate) => canManagePermission(actorPermissions, candidate)),
    [actorPermissions],
  );

  const reload = useCallback(async (selected: string) => {
    setBusy(true);
    try { setItems(await fetchStaffGrants(selected)); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Staff unavailable.'); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const context = await fetchMerchantCatalogContext();
        const selected = params.outletId && context.outletIds.includes(params.outletId)
          ? params.outletId : context.outletIds[0];
        if (!selected) { setMessage('No authorized outlet is available.'); return; }
        setOutletId(selected);
        setActorPermissions(context.permissionsByOutlet[selected] ?? []);
        if (canManageStaff(context.permissionsByOutlet[selected] ?? [])) await reload(selected);
        else setMessage('Owner or outlet manager permission is required.');
      } catch (error) { setMessage(error instanceof Error ? error.message : 'Staff unavailable.'); }
      finally { setBusy(false); }
    })();
  }, [params.outletId, reload]);

  async function grant() {
    if (!outletId || busy || !canManagePermission(actorPermissions, permission)) return;
    setBusy(true); setMessage('');
    try {
      await grantStaffPermission(outletId, accountId.trim(), permission);
      setAccountId('');
      await reload(outletId);
      setMessage('Permission granted.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Grant failed.'); setBusy(false); }
  }

  async function revoke(item: MerchantStaffGrant) {
    if (!outletId || busy || !canManagePermission(actorPermissions, item.permission)) return;
    setBusy(true); setMessage('');
    try {
      await revokeStaffPermission(outletId, item.accountId, item.permission);
      await reload(outletId);
      setMessage('Permission revoked.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Revoke failed.'); setBusy(false); }
  }

  return (
    <SafeAreaView style={styles.page}>
      <View style={styles.header}><Text style={styles.title}>Staff permissions</Text><Link href="/dashboard" style={styles.link}>Dashboard</Link></View>
      <ScrollView contentContainerStyle={styles.content}>
        {message ? <Text accessibilityRole="alert">{message}</Text> : null}
        {canManage ? (
          <View style={styles.panel}>
            <Text style={styles.section}>Add or re-enable</Text>
            <TextInput
              value={accountId}
              onChangeText={setAccountId}
              placeholder="Merchant account ID"
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
            />
            <View style={styles.permissions}>{assignable.map((candidate) => (
              <Pressable key={candidate} onPress={() => setPermission(candidate)} style={[styles.pill, permission === candidate && styles.selected]}>
                <Text style={permission === candidate ? styles.selectedText : styles.pillText}>{candidate}</Text>
              </Pressable>
            ))}</View>
            <Button title={busy ? 'Saving…' : 'Grant permission'} disabled={busy || !accountId.trim()} onPress={() => void grant()} />
          </View>
        ) : null}
        {items.map((item) => (
          <View key={`${item.accountId}-${item.permission}`} style={styles.panel}>
            <Text style={styles.staff}>{item.accountId}</Text>
            <Text>{item.permission} · {item.active ? 'Active' : 'Revoked'} · Account {item.accountStatus}</Text>
            {item.active && canManagePermission(actorPermissions, item.permission) ? (
              <Button title="Revoke permission" disabled={busy} color="#b91c1c" onPress={() => void revoke(item)} />
            ) : null}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f8fafc' }, header: { flexDirection: 'row', justifyContent: 'space-between', padding: 20 },
  title: { fontSize: 26, fontWeight: '800' }, link: { color: '#2563eb', fontWeight: '700' }, content: { padding: 20, paddingTop: 0, gap: 12 },
  panel: { backgroundColor: '#fff', padding: 16, borderRadius: 16, gap: 10 }, section: { fontSize: 18, fontWeight: '800' },
  input: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, padding: 12 }, permissions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { padding: 9, borderRadius: 999, backgroundColor: '#e2e8f0' }, selected: { backgroundColor: '#0f766e' },
  selectedText: { color: '#fff', fontWeight: '700' }, pillText: { color: '#334155' }, staff: { fontWeight: '800' },
});
