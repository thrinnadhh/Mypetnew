import { useCallback, useEffect, useMemo, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { Link } from 'expo-router';
import {
  Button,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { currentOfflineMerchantAccountId } from '../src/auth/offline-account';
import { installationId } from '../src/auth/session';
import { fetchMerchantCatalogContext } from '../src/catalog/api';
import { discoverOfflineCatalogPartitions } from '../src/catalog/offline-partitions';
import {
  canWriteCatalog,
  catalogMediaAssetFromPicker,
  createCatalogInput,
  emptyCatalogForm,
  type CatalogFormState,
} from '../src/catalog/model';
import { useMerchantDatabase } from '../src/data';
import { createPartitionContext, type MerchantPartitionContext } from '../src/data/models/partition-context';
import type { LocalCatalogDraft } from '../src/data/repositories/offline-catalog-draft-repository';
import { CatalogMediaJobCoordinator, encodeBase64Bytes } from '../src/sync/catalog-media-job-coordinator';
import { OfflineCatalogDraftService } from '../src/sync/offline-catalog-draft-service';
import { SyncCoordinator } from '../src/sync/sync-coordinator';

function partitionKey(context: MerchantPartitionContext): string {
  return `${context.accountId}:${context.organizationId}:${context.outletId}`;
}

function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof Error && /network|fetch|offline/i.test(error.message));
}

export default function OfflineCatalogOnboardingScreen() {
  const { database, isReady } = useMerchantDatabase();
  const [contexts, setContexts] = useState<MerchantPartitionContext[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<LocalCatalogDraft[]>([]);
  const [form, setForm] = useState<CatalogFormState>(() => emptyCatalogForm());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('');
  const [offlineContext, setOfflineContext] = useState(false);

  const selected = useMemo(
    () => contexts.find((context) => partitionKey(context) === selectedKey) ?? contexts[0] ?? null,
    [contexts, selectedKey],
  );

  const loadDrafts = useCallback(async (context: MerchantPartitionContext | null) => {
    if (!database || !context) {
      setDrafts([]);
      return;
    }
    const service = new OfflineCatalogDraftService(database, await installationId());
    setDrafts(await service.getDraftRepository().listDrafts(context));
  }, [database]);

  const loadContext = useCallback(async () => {
    if (!database || !isReady) return;
    setLoading(true);
    setMessage('');
    try {
      const accountId = await currentOfflineMerchantAccountId();
      if (!accountId) {
        setContexts([]);
        setMessage('A previously authenticated native Merchant session is required for offline drafts.');
        return;
      }

      let resolved: MerchantPartitionContext[] = [];
      try {
        const remote = await fetchMerchantCatalogContext();
        if (remote.organizationId) {
          resolved = remote.outletIds
            .filter((outletId) => canWriteCatalog(remote.permissionsByOutlet, outletId))
            .map((outletId) => createPartitionContext(accountId, remote.organizationId!, outletId));
        }
        setOfflineContext(false);
      } catch (error) {
        if (!isNetworkError(error)) throw error;
        resolved = await discoverOfflineCatalogPartitions(database, accountId);
        setOfflineContext(true);
      }

      setContexts(resolved);
      const first = resolved[0] ?? null;
      setSelectedKey(first ? partitionKey(first) : null);
      await loadDrafts(first);
      if (resolved.length === 0) {
        setMessage('No cached Merchant outlet is available. Reconnect once to establish an authorized catalog partition.');
      } else if (offlineContext) {
        setMessage('Offline mode: new work stays local and will be reauthorized by the server before it can become canonical.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not load offline catalog context.');
    } finally {
      setLoading(false);
    }
  }, [database, isReady, loadDrafts, offlineContext]);

  useEffect(() => {
    void loadContext();
  }, [loadContext]);

  function updateForm<K extends keyof CatalogFormState>(key: K, value: CatalogFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function choosePartition(context: MerchantPartitionContext) {
    setSelectedKey(partitionKey(context));
    await loadDrafts(context);
  }

  async function saveOfflineDraft() {
    if (!database || !selected || saving) return;
    setSaving(true);
    setMessage('');
    try {
      const input = createCatalogInput(form);
      const service = new OfflineCatalogDraftService(database, await installationId());
      const queued = await service.queueDraft(selected, input);
      setForm(emptyCatalogForm());
      await loadDrafts(selected);
      setMessage(`Draft ${queued.draft.tempListingId.slice(-8)} saved locally and queued for server reconciliation.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save the offline draft.');
    } finally {
      setSaving(false);
    }
  }

  async function addOfflineImage(draft: LocalCatalogDraft) {
    if (!database || !selected) return;
    setMessage('');
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setMessage('Photo library permission is required to attach an offline catalog image.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: false,
        quality: 1,
      });
      if (result.canceled || !result.assets[0]) return;
      const picked = result.assets[0];
      const validated = catalogMediaAssetFromPicker({
        uri: picked.uri,
        fileName: picked.fileName,
        mimeType: picked.mimeType,
        fileSize: picked.fileSize,
        file: picked.file ?? null,
      });
      const response = validated.file
        ? new Response(validated.file)
        : await fetch(validated.uri);
      if (!response.ok) throw new Error('Could not read the selected local image.');
      const buffer = await response.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      const service = new OfflineCatalogDraftService(database, await installationId());
      await service.getDraftRepository().enqueueMediaJob(selected, {
        tempListingId: draft.tempListingId,
        filename: validated.name,
        contentType: validated.type,
        bytesBase64: encodeBase64Bytes(bytes),
        sizeBytes: bytes.byteLength,
      });
      setMessage('Image stored locally. Product metadata can reconcile even if media upload later fails.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not queue the offline image.');
    }
  }

  async function syncNow() {
    if (!database || !selected || syncing) return;
    setSyncing(true);
    setMessage('Reconciling queued catalog work…');
    try {
      const service = new OfflineCatalogDraftService(database, await installationId());
      await service.recoverUnqueuedDrafts(selected);
      const commandSummary = await new SyncCoordinator(database).sync(selected);
      const mediaSummary = await new CatalogMediaJobCoordinator(database).sync(selected);
      await loadDrafts(selected);
      setMessage(
        `Reconciliation complete: ${commandSummary.acknowledged} command(s) accepted, ` +
        `${commandSummary.retryable} retryable, ${commandSummary.rejected} rejected; ` +
        `${mediaSummary.acknowledged} media upload(s) finalized.`,
      );
    } catch (error) {
      setMessage(
        isNetworkError(error)
          ? 'Still offline. Drafts and media remain durable and will retry after reconnect.'
          : (error instanceof Error ? error.message : 'Reconciliation could not complete.'),
      );
    } finally {
      setSyncing(false);
    }
  }

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Offline product onboarding</Text>
        <Text style={styles.body}>
          Capture an unknown barcode and metadata now. Nothing becomes customer-visible until the server accepts it.
        </Text>
        <Link href="/barcode" accessibilityRole="button">Scan or validate a barcode first</Link>

        {loading ? <Text accessibilityLiveRegion="polite">Loading offline catalog context…</Text> : null}
        {message ? <Text accessibilityRole="alert" style={styles.notice}>{message}</Text> : null}
        {offlineContext ? <Text style={styles.offlineBadge}>Offline · server reauthorization pending</Text> : null}

        {contexts.length > 1 ? (
          <View style={styles.rowWrap}>
            {contexts.map((context) => (
              <Pressable
                key={partitionKey(context)}
                accessibilityRole="button"
                style={styles.chip}
                onPress={() => void choosePartition(context)}
              >
                <Text>{selected && partitionKey(selected) === partitionKey(context) ? '✓ ' : ''}{context.outletId.slice(0, 8)}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {selected ? (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Unknown product draft</Text>
              <View style={styles.rowWrap}>
                {(['PRODUCT', 'MEDICINE'] as const).map((kind) => (
                  <Pressable key={kind} style={styles.chip} onPress={() => updateForm('kind', kind)} accessibilityRole="button">
                    <Text>{form.kind === kind ? '✓ ' : ''}{kind}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.rowWrap}>
                {(['INTERNAL', 'GTIN_8', 'GTIN_12', 'GTIN_13', 'GTIN_14'] as const).map((type) => (
                  <Pressable key={type} style={styles.chip} onPress={() => updateForm('barcodeType', type)} accessibilityRole="button">
                    <Text>{form.barcodeType === type ? '✓ ' : ''}{type}</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput value={form.barcode} onChangeText={(value) => updateForm('barcode', value)} placeholder="Barcode" style={styles.input} />
              <TextInput value={form.name} onChangeText={(value) => updateForm('name', value)} placeholder="Product name" style={styles.input} />
              <TextInput value={form.mrpPaise} onChangeText={(value) => updateForm('mrpPaise', value)} placeholder="MRP in paise" keyboardType="number-pad" style={styles.input} />
              <TextInput value={form.sellingPricePaise} onChangeText={(value) => updateForm('sellingPricePaise', value)} placeholder="Selling price in paise" keyboardType="number-pad" style={styles.input} />
              <TextInput value={form.category} onChangeText={(value) => updateForm('category', value)} placeholder="category-slug" autoCapitalize="none" style={styles.input} />
              <TextInput value={form.brand} onChangeText={(value) => updateForm('brand', value)} placeholder="Brand (optional)" style={styles.input} />
              <TextInput value={form.sku} onChangeText={(value) => updateForm('sku', value)} placeholder="SKU (optional)" style={styles.input} />
              <TextInput value={form.packLabel} onChangeText={(value) => updateForm('packLabel', value)} placeholder="Pack label (optional)" style={styles.input} />
              <TextInput value={form.petType} onChangeText={(value) => updateForm('petType', value)} placeholder="Pet type (optional)" style={styles.input} />
              <TextInput value={form.lifeStage} onChangeText={(value) => updateForm('lifeStage', value)} placeholder="Life stage (optional)" style={styles.input} />
              <TextInput value={form.description} onChangeText={(value) => updateForm('description', value)} placeholder="Description (optional)" multiline style={[styles.input, styles.multiline]} />
              <Button title={saving ? 'Saving locally…' : 'Save offline draft'} disabled={saving || syncing} onPress={() => void saveOfflineDraft()} />
              <Button title={syncing ? 'Reconciling…' : 'Sync queued work now'} disabled={saving || syncing} onPress={() => void syncNow()} />
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Local drafts</Text>
              {drafts.length === 0 ? <Text>No local drafts for this outlet.</Text> : null}
              {drafts.map((draft) => (
                <View key={draft.tempListingId} style={styles.card}>
                  <Text style={styles.cardTitle}>{draft.name}</Text>
                  <Text>{draft.barcodeType} · {draft.barcode}</Text>
                  <Text>State: {draft.state}</Text>
                  <Text>Local ID: {draft.tempListingId.slice(-12)}</Text>
                  {draft.canonicalListingId ? <Text>Canonical ID: {draft.canonicalListingId.slice(0, 12)}…</Text> : null}
                  {draft.lastErrorCode ? <Text style={styles.errorText}>Server result: {draft.lastErrorCode}</Text> : null}
                  {draft.conflictJson ? <Text style={styles.errorText}>Conflict requires review; local metadata is preserved.</Text> : null}
                  <Button title="Attach offline image" disabled={syncing} onPress={() => void addOfflineImage(draft)} />
                </View>
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 20, gap: 16 },
  title: { fontSize: 24, fontWeight: '800' },
  body: { fontSize: 15, lineHeight: 21, color: '#475569' },
  notice: { padding: 12, borderRadius: 10, backgroundColor: '#f8fafc', color: '#334155' },
  offlineBadge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: '#fff7ed', color: '#9a3412', fontWeight: '700' },
  section: { gap: 10, padding: 16, borderRadius: 14, borderWidth: 1, borderColor: '#e2e8f0' },
  sectionTitle: { fontSize: 18, fontWeight: '800' },
  input: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  multiline: { minHeight: 88, textAlignVertical: 'top' },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  chip: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: '#f8fafc' },
  card: { gap: 6, padding: 14, borderRadius: 12, backgroundColor: '#f8fafc' },
  cardTitle: { fontWeight: '800', fontSize: 16 },
  errorText: { color: '#b91c1c' },
});
