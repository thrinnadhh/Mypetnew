import * as ImagePicker from 'expo-image-picker';
import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { loadOfflineMerchantAccountId } from '../src/auth/offline-account';
import { installationId } from '../src/auth/session';
import { resolveMerchantBarcode } from '../src/barcode/api';
import { normalizeMerchantBarcode } from '../src/barcode/model';
import {
  fetchMerchantCatalogContext,
  type BarcodeType,
  type ListingKind,
  type MerchantListing,
} from '../src/catalog/api';
import { catalogErrorMessage, catalogOutletLabel, catalogSelectedLabel } from '../src/catalog/model';
import { useMerchantDatabase } from '../src/data';
import { createPartitionContext, type MerchantPartitionContext } from '../src/data/models/partition-context';
import type { CatalogDraft } from '../src/data/models/draft-types';
import { CommandOutboxRepository } from '../src/data/repositories/command-outbox-repository';
import { PartitionDiscoveryRepository } from '../src/data/repositories/partition-discovery-repository';
import { SyncCoordinator } from '../src/sync/sync-coordinator';

const BARCODE_TYPES: BarcodeType[] = ['GTIN_8', 'GTIN_12', 'GTIN_13', 'GTIN_14', 'INTERNAL'];

function moneyToPaise(value: string): number {
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error('Enter a valid non-negative price');
  return Math.round(parsed * 100);
}

function partitionKey(context: MerchantPartitionContext): string {
  return `${context.accountId}:${context.organizationId}:${context.outletId}`;
}

export default function MerchantBarcodeScreen() {
  const { database, barcodeRepo, draftRepo, pendingMediaRepo } = useMerchantDatabase();
  const [partitions, setPartitions] = useState<MerchantPartitionContext[]>([]);
  const [activePartition, setActivePartition] = useState<MerchantPartitionContext | null>(null);
  const [onlineOutletIds, setOnlineOutletIds] = useState<string[]>([]);
  const [onlineOrganizationId, setOnlineOrganizationId] = useState<string | null>(null);
  const [barcodeType, setBarcodeType] = useState<BarcodeType>('GTIN_13');
  const [barcode, setBarcode] = useState('');
  const [listing, setListing] = useState<MerchantListing | null>(null);
  const [draft, setDraft] = useState<CatalogDraft | null>(null);
  const [unknownBarcode, setUnknownBarcode] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState(false);
  const [message, setMessage] = useState('');
  const [draftName, setDraftName] = useState('');
  const [kind, setKind] = useState<ListingKind>('PRODUCT');
  const [mrp, setMrp] = useState('');
  const [sellingPrice, setSellingPrice] = useState('');
  const [category, setCategory] = useState('other');

  const outletId = activePartition?.outletId ?? onlineOutletIds[0] ?? null;
  const canCreateOfflineDraft = Boolean(activePartition && draftRepo && database);
  const draftCommerceMode = useMemo(() => (kind === 'MEDICINE' ? 'VIEW_ONLY' : 'COMMERCE'), [kind]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const accountId = await loadOfflineMerchantAccountId();
        let cached: MerchantPartitionContext[] = [];
        if (accountId && database) {
          cached = await new PartitionDiscoveryRepository(database).listKnownPartitionsForAccount(accountId);
        }

        try {
          const remote = await fetchMerchantCatalogContext();
          if (!active) return;
          setOnlineOutletIds(remote.outletIds);
          setOnlineOrganizationId(remote.organizationId);
          if (accountId && remote.organizationId) {
            const remotePartitions = remote.outletIds.map((id) => createPartitionContext(accountId, remote.organizationId!, id));
            const unique = new Map<string, MerchantPartitionContext>();
            [...cached, ...remotePartitions].forEach((item) => unique.set(partitionKey(item), item));
            cached = [...unique.values()];
          }
        } catch {
          // Offline startup is expected. Cached partitions remain authoritative for local access.
        }

        if (!active) return;
        setPartitions(cached);
        setActivePartition(cached[0] ?? null);
        if (cached.length === 0 && accountId) {
          setMessage('No cached outlet partition is available. Reconnect once to bootstrap this device.');
        }
      } catch (error) {
        if (active) setMessage(catalogErrorMessage(error));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [database]);

  function resetResolution() {
    setListing(null);
    setDraft(null);
    setUnknownBarcode(null);
    setMessage('');
  }

  async function resolve() {
    if (!outletId || resolving) return;
    setResolving(true);
    resetResolution();
    try {
      const normalized = normalizeMerchantBarcode(barcodeType, barcode);
      setBarcode(normalized);

      if (activePartition && barcodeRepo && draftRepo) {
        const local = await barcodeRepo.processScanOffline(activePartition, barcodeType, normalized);
        if (local.found) {
          setListing(local.listing);
          setMessage('Existing listing resolved instantly from the local catalog cache.');
          return;
        }
        if (local.ambiguous?.length) {
          setMessage('Multiple cached listings match this barcode. Refresh before making changes.');
          return;
        }
        const existingDraft = await draftRepo.findByBarcode(activePartition, barcodeType, normalized);
        if (existingDraft && existingDraft.status !== 'SYNCED') {
          setDraft(existingDraft);
          setMessage(`Local draft already exists (${existingDraft.status}).`);
          return;
        }
        setUnknownBarcode(normalized);
        setMessage('Unknown barcode. You can create a local-only draft and continue offline.');
        return;
      }

      // Web/runtime fallback where native secure account identity is intentionally unavailable.
      const online = await resolveMerchantBarcode(outletId, barcodeType, normalized);
      if (online.listing) {
        setListing(online.listing);
        setMessage('Existing listing found in this outlet.');
      } else {
        setUnknownBarcode(online.normalizedBarcode);
        setMessage('Barcode is valid and unused, but native offline draft identity is unavailable in this runtime.');
      }
    } catch (error) {
      setMessage(catalogErrorMessage(error));
    } finally {
      setResolving(false);
    }
  }

  async function createDraft() {
    if (!activePartition || !draftRepo || !database || !unknownBarcode) return;
    try {
      const created = await draftRepo.createDraft(activePartition, {
        barcodeType,
        barcode: unknownBarcode,
        name: draftName,
        kind,
        mrpPaise: moneyToPaise(mrp),
        sellingPricePaise: moneyToPaise(sellingPrice),
        category: category.trim().toLowerCase() || 'other',
      });
      const outbox = new CommandOutboxRepository(database);
      await draftRepo.queueForSync(activePartition, created.localId, outbox, await installationId());
      const queued = await draftRepo.getDraft(activePartition, created.localId);
      setDraft(queued ?? created);
      setUnknownBarcode(null);
      setMessage('Local draft saved and queued. No canonical server listing ID has been fabricated.');
    } catch (error) {
      setMessage(catalogErrorMessage(error));
    }
  }

  async function attachPendingImage() {
    if (!activePartition || !draft || !pendingMediaRepo) return;
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setMessage('Photo permission is required to attach pending media.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.9,
        allowsMultipleSelection: false,
      });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      const mime = asset.mimeType;
      if (mime !== 'image/jpeg' && mime !== 'image/png' && mime !== 'image/webp') {
        throw new Error('LISTING_IMAGE_INVALID');
      }
      await pendingMediaRepo.add(activePartition, draft.localId, asset.uri, mime);
      setMessage('Image stored as pending local media. Upload waits for canonical listing identity.');
    } catch (error) {
      setMessage(catalogErrorMessage(error));
    }
  }

  async function syncNow() {
    if (!activePartition || !database) return;
    try {
      const summary = await new SyncCoordinator(database).sync(activePartition);
      if (draft && draftRepo) setDraft(await draftRepo.getDraft(activePartition, draft.localId));
      setMessage(`Sync processed ${summary.commandsProcessed} command(s); ${summary.acknowledged} acknowledged.`);
    } catch (error) {
      setMessage(catalogErrorMessage(error));
    }
  }

  function choosePartition(next: MerchantPartitionContext) {
    setActivePartition(next);
    resetResolution();
  }

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Offline barcode onboarding</Text>
        <Text style={styles.body}>
          Manual or camera-adapter scan values are normalized locally first. Known products open from the cached catalog; unknown products become local drafts until the backend assigns canonical identity.
        </Text>

        {partitions.length > 1 ? (
          <View style={styles.rowWrap}>
            {partitions.map((partition) => (
              <Pressable key={partitionKey(partition)} accessibilityRole="button" onPress={() => choosePartition(partition)} style={styles.chip}>
                <Text>{catalogOutletLabel(partition.outletId, activePartition?.outletId ?? null)}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {!loading && !outletId ? <Text accessibilityRole="alert">No authorized or cached Merchant outlet is available.</Text> : null}
        {activePartition ? <Text style={styles.partition}>Offline partition: {activePartition.organizationId.slice(0, 8)}… / {activePartition.outletId.slice(0, 8)}…</Text> : null}

        <Text style={styles.label}>Barcode type</Text>
        <View style={styles.rowWrap}>
          {BARCODE_TYPES.map((type) => (
            <Pressable
              key={type}
              accessibilityRole="button"
              onPress={() => {
                setBarcodeType(type);
                resetResolution();
              }}
              style={styles.chip}
            >
              <Text>{catalogSelectedLabel(barcodeType, type)}</Text>
            </Pressable>
          ))}
        </View>

        <TextInput
          value={barcode}
          onChangeText={(value) => {
            setBarcode(value);
            resetResolution();
          }}
          autoCapitalize={barcodeType === 'INTERNAL' ? 'characters' : 'none'}
          keyboardType={barcodeType === 'INTERNAL' ? 'default' : 'number-pad'}
          placeholder="Scan result or manual barcode"
          accessibilityLabel="Barcode value"
          style={styles.input}
        />
        <Button
          title={resolving ? 'Resolving…' : 'Resolve locally'}
          disabled={loading || resolving || !outletId || barcode.trim().length === 0}
          onPress={() => void resolve()}
        />

        {message ? <Text accessibilityRole="alert" style={styles.notice}>{message}</Text> : null}

        {listing ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{listing.name}</Text>
            <Text>{listing.kind} · {listing.status}</Text>
            <Text>{listing.barcodeType} · {listing.normalizedBarcode}</Text>
            <Text>Canonical listing ID: {listing.id}</Text>
          </View>
        ) : null}

        {unknownBarcode && canCreateOfflineDraft ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Create offline product draft</Text>
            <Text>{barcodeType} · {unknownBarcode}</Text>
            <TextInput value={draftName} onChangeText={setDraftName} placeholder="Product name" style={styles.input} />
            <View style={styles.rowWrap}>
              {(['PRODUCT', 'MEDICINE'] as ListingKind[]).map((value) => (
                <Pressable key={value} accessibilityRole="button" onPress={() => setKind(value)} style={styles.chip}>
                  <Text>{catalogSelectedLabel(kind, value)}</Text>
                </Pressable>
              ))}
            </View>
            <Text>Commerce mode: {draftCommerceMode}{kind === 'MEDICINE' ? ' (policy enforced)' : ''}</Text>
            <TextInput value={mrp} onChangeText={setMrp} placeholder="MRP ₹" keyboardType="decimal-pad" style={styles.input} />
            <TextInput value={sellingPrice} onChangeText={setSellingPrice} placeholder="Selling price ₹" keyboardType="decimal-pad" style={styles.input} />
            <TextInput value={category} onChangeText={setCategory} placeholder="Category slug" autoCapitalize="none" style={styles.input} />
            <Button title="Save local draft" onPress={() => void createDraft()} />
          </View>
        ) : null}

        {draft ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{draft.name}</Text>
            <Text>Status: {draft.status}</Text>
            <Text>Local ID: {draft.localId}</Text>
            <Text>Canonical ID: {draft.canonicalListingId ?? 'not assigned'}</Text>
            {draft.rejectionCode ? <Text>Server reason: {draft.rejectionCode} — {draft.rejectionDetails}</Text> : null}
            {!draft.canonicalListingId ? <Button title="Attach pending image" onPress={() => void attachPendingImage()} /> : null}
            <Button title="Sync now" onPress={() => void syncNow()} />
          </View>
        ) : null}

        {onlineOrganizationId && !activePartition ? (
          <Text style={styles.body}>Online organization context: {onlineOrganizationId.slice(0, 8)}…</Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 20, gap: 14 },
  title: { fontSize: 28, fontWeight: '800' },
  body: { fontSize: 14, lineHeight: 20, color: '#4b5563' },
  partition: { fontSize: 12, color: '#475569' },
  label: { fontSize: 13, fontWeight: '700' },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  chip: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  input: { minHeight: 46, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  notice: { padding: 12, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10 },
  card: { gap: 9, padding: 14, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12 },
  cardTitle: { fontSize: 16, fontWeight: '800' },
});
