import { useCallback, useEffect, useMemo, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
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
import {
  type BarcodeType,
  type CatalogMediaAsset,
  catalogMediaCommandKey,
  changeListingStatus,
  createListing,
  fetchCatalogPage,
  fetchMerchantCatalogContext,
  type ListingKind,
  type MerchantListing,
  updateListing,
  uploadCatalogMedia,
} from '../src/catalog/api';
import {
  applyCatalogMediaAttachment,
  canUploadCatalogMedia,
  canWriteCatalog,
  catalogAccessNotice,
  catalogEditorTitle,
  catalogEmptyStateMessage,
  catalogErrorMessage,
  catalogFormFromListing,
  catalogIdentitySummary,
  catalogListingCard,
  catalogMediaAssetFromPicker,
  catalogMediaQuotaLabel,
  catalogOutletLabel,
  catalogPageLabel,
  catalogSaveButtonTitle,
  catalogSearchOptions,
  catalogSelectedLabel,
  catalogStatusSuccessMessage,
  createCatalogInput,
  emptyCatalogForm,
  mutableCatalogInput,
  nextCatalogStatus,
  shouldReloadCatalogAfterError,
  type CatalogFormState,
  type CatalogStatusFilter,
} from '../src/catalog/model';

type PendingMediaUpload = {
  listing: MerchantListing;
  asset: CatalogMediaAsset;
  idempotencyKey: string;
};

export default function MerchantCatalogScreen() {
  const [outletIds, setOutletIds] = useState<string[]>([]);
  const [permissions, setPermissions] = useState<Record<string, string[]>>({});
  const [outletId, setOutletId] = useState<string | null>(null);
  const [items, setItems] = useState<MerchantListing[]>([]);
  const [page, setPage] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<CatalogStatusFilter>('ALL');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [pendingMedia, setPendingMedia] = useState<PendingMediaUpload | null>(null);
  const [message, setMessage] = useState('');
  const [editing, setEditing] = useState<MerchantListing | null>(null);
  const [form, setForm] = useState<CatalogFormState>(() => emptyCatalogForm());

  const canWrite = useMemo(() => canWriteCatalog(permissions, outletId), [outletId, permissions]);
  const accessNotice = catalogAccessNotice(outletId, loading, canWrite);
  const emptyStateMessage = catalogEmptyStateMessage(loading, items.length);

  const loadPage = useCallback(async (selectedOutlet: string, selectedPage = page) => {
    setLoading(true);
    setMessage('');
    try {
      const result = await fetchCatalogPage(selectedOutlet, catalogSearchOptions(query, status, selectedPage));
      setItems(result.items);
      setPage(result.page);
      setHasNext(result.hasNext);
    } catch (error) {
      setMessage(catalogErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [page, query, status]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const context = await fetchMerchantCatalogContext();
        if (!active) return;
        setOutletIds(context.outletIds);
        setPermissions(context.permissionsByOutlet);
        const firstOutlet = context.outletIds[0] ?? null;
        setOutletId(firstOutlet);
        if (firstOutlet) await loadPage(firstOutlet, 0);
      } catch (error) {
        if (active) setMessage(catalogErrorMessage(error));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []); // Context is intentionally loaded once per screen mount.

  function updateForm<K extends keyof CatalogFormState>(key: K, value: CatalogFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function startCreate() {
    setEditing(null);
    setForm(emptyCatalogForm());
    setMessage('');
  }

  function startEdit(listing: MerchantListing) {
    setEditing(listing);
    setForm(catalogFormFromListing(listing));
    setMessage('');
  }

  async function save() {
    if (!outletId || saving || uploadingMedia || !canWrite) return;
    setSaving(true);
    setMessage('');
    try {
      if (editing) {
        await updateListing(editing, mutableCatalogInput(form));
        setMessage('Listing updated.');
      } else {
        await createListing(outletId, createCatalogInput(form));
        setMessage('Listing created.');
      }
      setEditing(null);
      setForm(emptyCatalogForm());
      await loadPage(outletId, 0);
    } catch (error) {
      setMessage(catalogErrorMessage(error));
      if (shouldReloadCatalogAfterError(error)) await loadPage(outletId, page);
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(listing: MerchantListing) {
    if (!canWrite || saving || uploadingMedia || !outletId) return;
    setSaving(true);
    setMessage('');
    try {
      const target = nextCatalogStatus(listing.status);
      await changeListingStatus(listing, target);
      setMessage(catalogStatusSuccessMessage(target));
      await loadPage(outletId, page);
    } catch (error) {
      setMessage(catalogErrorMessage(error));
      if (shouldReloadCatalogAfterError(error)) await loadPage(outletId, page);
    } finally {
      setSaving(false);
    }
  }

  async function performMediaUpload(pending: PendingMediaUpload) {
    if (uploadingMedia || !canWrite) return;
    setUploadingMedia(true);
    setMessage('Uploading catalog image…');
    try {
      const attachment = await uploadCatalogMedia(pending.listing, pending.asset, pending.idempotencyKey);
      const canonical = applyCatalogMediaAttachment(pending.listing, attachment);
      setItems((current) => current.map((item) => (
        item.id === canonical.id && item.version === pending.listing.version ? canonical : item
      )));
      setPendingMedia(null);
      setMessage('Catalog image uploaded.');
      await loadPage(pending.listing.outletId, page);
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      const terminal = [
        'CATALOG_VERSION_CONFLICT',
        'CATALOG_MEDIA_QUOTA_EXCEEDED',
        'CATALOG_MEDIA_INVALID',
        'CATALOG_MEDIA_LOCAL_FILE_REQUIRED',
        'MERCHANT_PERMISSION_REQUIRED',
        'RESOURCE_NOT_FOUND',
      ].includes(name);
      if (terminal) setPendingMedia(null);
      else setPendingMedia(pending); // Preserve the original listing snapshot + idempotency key for retry.
      setMessage(catalogErrorMessage(error));
      if (name === 'CATALOG_VERSION_CONFLICT') {
        await loadPage(pending.listing.outletId, page);
      }
    } finally {
      setUploadingMedia(false);
    }
  }

  async function chooseCatalogImage(listing: MerchantListing) {
    if (!canWrite || saving || uploadingMedia) return;
    if (!canUploadCatalogMedia(listing)) {
      setMessage(
        listing.status !== 'ACTIVE'
          ? 'Activate the listing before adding catalog images.'
          : 'This listing already has the maximum of 5 images.',
      );
      return;
    }

    setMessage('');
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setMessage('Photo library permission is required to choose a catalog image.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: false,
        quality: 1,
      });
      if (result.canceled || !result.assets[0]) return;
      const selected = result.assets[0];
      const asset = catalogMediaAssetFromPicker({
        uri: selected.uri,
        fileName: selected.fileName,
        mimeType: selected.mimeType,
        fileSize: selected.fileSize,
        file: selected.file ?? null,
      });
      const pending = {
        listing,
        asset,
        idempotencyKey: catalogMediaCommandKey(),
      } satisfies PendingMediaUpload;
      setPendingMedia(pending);
      await performMediaUpload(pending);
    } catch (error) {
      setMessage(catalogErrorMessage(error));
    }
  }

  async function chooseOutlet(nextOutletId: string) {
    setOutletId(nextOutletId);
    setEditing(null);
    setPendingMedia(null);
    setForm(emptyCatalogForm());
    setPage(0);
    await loadPage(nextOutletId, 0);
  }

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Catalog</Text>
        <Text style={styles.body}>Versioned product management with managed catalog images and barcode-safe listing identity.</Text>

        {outletIds.length > 1 ? (
          <View style={styles.rowWrap}>
            {outletIds.map((id) => (
              <Pressable key={id} accessibilityRole="button" onPress={() => void chooseOutlet(id)} style={styles.chip}>
                <Text>{catalogOutletLabel(id, outletId)}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {accessNotice ? <Text accessibilityRole="alert" style={styles.notice}>{accessNotice}</Text> : null}
        {message ? <Text accessibilityRole="alert" style={styles.notice}>{message}</Text> : null}

        {outletId ? (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Find listings</Text>
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Name, category, brand or SKU"
                style={styles.input}
                accessibilityLabel="Catalog search"
              />
              <View style={styles.rowWrap}>
                {(['ALL', 'ACTIVE', 'INACTIVE'] as CatalogStatusFilter[]).map((value) => (
                  <Pressable key={value} accessibilityRole="button" onPress={() => setStatus(value)} style={styles.chip}>
                    <Text>{catalogSelectedLabel(status, value)}</Text>
                  </Pressable>
                ))}
              </View>
              <Button title="Search" onPress={() => void loadPage(outletId, 0)} disabled={loading || uploadingMedia} />
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{catalogEditorTitle(editing)}</Text>
              {!editing ? (
                <>
                  <Text style={styles.label}>Listing kind</Text>
                  <View style={styles.rowWrap}>
                    {(['PRODUCT', 'MEDICINE'] as ListingKind[]).map((value) => (
                      <Pressable key={value} accessibilityRole="button" onPress={() => updateForm('kind', value)} style={styles.chip}>
                        <Text>{catalogSelectedLabel(form.kind, value)}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <Text style={styles.label}>Barcode type</Text>
                  <View style={styles.rowWrap}>
                    {(['INTERNAL', 'GTIN_13'] as BarcodeType[]).map((value) => (
                      <Pressable key={value} accessibilityRole="button" onPress={() => updateForm('barcodeType', value)} style={styles.chip}>
                        <Text>{catalogSelectedLabel(form.barcodeType, value)}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <TextInput value={form.barcode} onChangeText={(value) => updateForm('barcode', value)} placeholder="Barcode or internal code" style={styles.input} />
                </>
              ) : (
                <Text style={styles.body}>Identity: {catalogIdentitySummary(editing)}</Text>
              )}
              <TextInput value={form.name} onChangeText={(value) => updateForm('name', value)} placeholder="Product name" style={styles.input} />
              <TextInput value={form.mrpPaise} onChangeText={(value) => updateForm('mrpPaise', value)} placeholder="MRP in paise" keyboardType="number-pad" style={styles.input} />
              <TextInput value={form.sellingPricePaise} onChangeText={(value) => updateForm('sellingPricePaise', value)} placeholder="Selling price in paise" keyboardType="number-pad" style={styles.input} />
              <TextInput value={form.category} onChangeText={(value) => updateForm('category', value)} autoCapitalize="none" placeholder="category-slug" style={styles.input} />
              <TextInput value={form.brand} onChangeText={(value) => updateForm('brand', value)} placeholder="Brand (optional)" style={styles.input} />
              <TextInput value={form.sku} onChangeText={(value) => updateForm('sku', value)} placeholder="SKU (optional)" style={styles.input} />
              <TextInput value={form.packLabel} onChangeText={(value) => updateForm('packLabel', value)} placeholder="Pack label (optional)" style={styles.input} />
              <TextInput value={form.petType} onChangeText={(value) => updateForm('petType', value)} placeholder="Pet type (optional)" style={styles.input} />
              <TextInput value={form.lifeStage} onChangeText={(value) => updateForm('lifeStage', value)} placeholder="Life stage (optional)" style={styles.input} />
              <TextInput value={form.description} onChangeText={(value) => updateForm('description', value)} placeholder="Description (optional)" multiline style={[styles.input, styles.multiline]} />
              <Button
                title={catalogSaveButtonTitle(saving, editing)}
                disabled={saving || uploadingMedia || !canWrite}
                onPress={() => void save()}
              />
              {editing ? <Button title="Cancel edit" disabled={saving || uploadingMedia} onPress={startCreate} /> : null}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Listings</Text>
              {loading ? <Text accessibilityLiveRegion="polite">Loading catalog…</Text> : null}
              {emptyStateMessage ? <Text>{emptyStateMessage}</Text> : null}
              {items.map((listing) => {
                const card = catalogListingCard(listing);
                const isPending = pendingMedia?.listing.id === listing.id;
                return (
                  <View key={listing.id} style={styles.card}>
                    <Text style={styles.cardTitle}>{listing.name}</Text>
                    <Text>{card.stateLine}</Text>
                    <Text>{card.priceLine}</Text>
                    <Text>{card.metadataLine}</Text>
                    <Text>{catalogMediaQuotaLabel(listing)}</Text>
                    <View style={styles.rowWrap}>
                      <Button title="Edit" disabled={!canWrite || saving || uploadingMedia} onPress={() => startEdit(listing)} />
                      <Button
                        title={card.actionLabel}
                        disabled={!canWrite || saving || uploadingMedia}
                        onPress={() => void toggleStatus(listing)}
                      />
                      <Button
                        title={uploadingMedia && isPending ? 'Uploading…' : 'Add image'}
                        disabled={!canWrite || saving || uploadingMedia || !canUploadCatalogMedia(listing)}
                        onPress={() => void chooseCatalogImage(listing)}
                      />
                      {isPending && !uploadingMedia ? (
                        <Button title="Retry image upload" onPress={() => void performMediaUpload(pendingMedia)} />
                      ) : null}
                    </View>
                  </View>
                );
              })}
              <View style={styles.rowWrap}>
                <Button title="Previous" disabled={loading || uploadingMedia || page === 0} onPress={() => outletId && void loadPage(outletId, page - 1)} />
                <Text>{catalogPageLabel(page)}</Text>
                <Button title="Next" disabled={loading || uploadingMedia || !hasNext} onPress={() => outletId && void loadPage(outletId, page + 1)} />
              </View>
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
  title: { fontSize: 28, fontWeight: '800' },
  body: { fontSize: 14, lineHeight: 20, color: '#4b5563' },
  notice: { padding: 12, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10 },
  section: { gap: 10, padding: 16, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 14 },
  sectionTitle: { fontSize: 18, fontWeight: '800' },
  label: { fontSize: 13, fontWeight: '700' },
  input: { minHeight: 46, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  multiline: { minHeight: 88, textAlignVertical: 'top' },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  chip: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  card: { gap: 7, padding: 14, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12 },
  cardTitle: { fontSize: 16, fontWeight: '800' },
});
