import { useCallback, useEffect, useMemo, useState } from 'react';
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
  BarcodeType,
  changeListingStatus,
  createListing,
  fetchCatalogPage,
  fetchMerchantCatalogContext,
  ListingKind,
  ListingStatus,
  MerchantListing,
  updateListing,
} from '../src/catalog/api';

type StatusFilter = ListingStatus | 'ALL';

type FormState = {
  barcodeType: BarcodeType;
  barcode: string;
  kind: ListingKind;
  name: string;
  mrpPaise: string;
  sellingPricePaise: string;
  category: string;
  brand: string;
  description: string;
  petType: string;
  lifeStage: string;
  packLabel: string;
  sku: string;
};

const EMPTY_FORM: FormState = {
  barcodeType: 'INTERNAL',
  barcode: '',
  kind: 'PRODUCT',
  name: '',
  mrpPaise: '',
  sellingPricePaise: '',
  category: 'other',
  brand: '',
  description: '',
  petType: '',
  lifeStage: '',
  packLabel: '',
  sku: '',
};

function parsePaise(value: string, field: string): number {
  if (!/^\d+$/.test(value.trim())) throw new Error(`${field} must be a whole number of paise.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${field} is outside the supported range.`);
  return parsed;
}

function messageFor(error: unknown): string {
  if (!(error instanceof Error)) return 'The catalog action could not be completed.';
  if (error.name === 'CATALOG_VERSION_CONFLICT') return 'This listing changed on the server. The latest version was reloaded.';
  if (error.name === 'CATALOG_DUPLICATE') return 'That barcode already identifies another listing in this outlet.';
  if (error.name === 'MERCHANT_PERMISSION_REQUIRED' || error.name === 'RESOURCE_NOT_FOUND') {
    return 'Your current Merchant access does not allow this catalog action.';
  }
  return error.message;
}

export default function MerchantCatalogScreen() {
  const [outletIds, setOutletIds] = useState<string[]>([]);
  const [permissions, setPermissions] = useState<Record<string, string[]>>({});
  const [outletId, setOutletId] = useState<string | null>(null);
  const [items, setItems] = useState<MerchantListing[]>([]);
  const [page, setPage] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [editing, setEditing] = useState<MerchantListing | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const canWrite = useMemo(() => {
    if (!outletId) return false;
    const granted = permissions[outletId] ?? [];
    return granted.includes('OWNER') || granted.includes('CATALOG_WRITE');
  }, [outletId, permissions]);

  const loadPage = useCallback(async (selectedOutlet: string, selectedPage = page) => {
    setLoading(true);
    setMessage('');
    try {
      const result = await fetchCatalogPage(selectedOutlet, {
        query,
        status: status === 'ALL' ? undefined : status,
        page: selectedPage,
        pageSize: 25,
      });
      setItems(result.items);
      setPage(result.page);
      setHasNext(result.hasNext);
    } catch (error) {
      setMessage(messageFor(error));
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
        if (active) setMessage(messageFor(error));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []); // Context is intentionally loaded once per screen mount.

  function updateForm<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function startCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setMessage('');
  }

  function startEdit(listing: MerchantListing) {
    setEditing(listing);
    setForm({
      barcodeType: listing.barcodeType,
      barcode: listing.normalizedBarcode,
      kind: listing.kind,
      name: listing.name,
      mrpPaise: String(listing.mrpPaise),
      sellingPricePaise: String(listing.sellingPricePaise),
      category: listing.category,
      brand: listing.brand ?? '',
      description: listing.description ?? '',
      petType: listing.petType ?? '',
      lifeStage: listing.lifeStage ?? '',
      packLabel: listing.packLabel ?? '',
      sku: listing.sku ?? '',
    });
    setMessage('');
  }

  async function save() {
    if (!outletId || saving || !canWrite) return;
    setSaving(true);
    setMessage('');
    try {
      const mutable = {
        name: form.name,
        mrpPaise: parsePaise(form.mrpPaise, 'MRP'),
        sellingPricePaise: parsePaise(form.sellingPricePaise, 'Selling price'),
        category: form.category,
        brand: form.brand || null,
        description: form.description || null,
        petType: form.petType || null,
        lifeStage: form.lifeStage || null,
        packLabel: form.packLabel || null,
        sku: form.sku || null,
      };
      if (editing) {
        await updateListing(editing, mutable);
        setMessage('Listing updated.');
      } else {
        await createListing(outletId, {
          ...mutable,
          barcodeType: form.barcodeType,
          barcode: form.barcode,
          kind: form.kind,
        });
        setMessage('Listing created.');
      }
      setEditing(null);
      setForm(EMPTY_FORM);
      await loadPage(outletId, 0);
    } catch (error) {
      setMessage(messageFor(error));
      if (error instanceof Error && error.name === 'CATALOG_VERSION_CONFLICT') await loadPage(outletId, page);
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(listing: MerchantListing) {
    if (!canWrite || saving || !outletId) return;
    setSaving(true);
    setMessage('');
    try {
      const target: ListingStatus = listing.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
      await changeListingStatus(listing, target);
      setMessage(target === 'ACTIVE' ? 'Listing activated.' : 'Listing deactivated.');
      await loadPage(outletId, page);
    } catch (error) {
      setMessage(messageFor(error));
      if (error instanceof Error && error.name === 'CATALOG_VERSION_CONFLICT') await loadPage(outletId, page);
    } finally {
      setSaving(false);
    }
  }

  async function chooseOutlet(nextOutletId: string) {
    setOutletId(nextOutletId);
    setEditing(null);
    setForm(EMPTY_FORM);
    setPage(0);
    await loadPage(nextOutletId, 0);
  }

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Catalog</Text>
        <Text style={styles.body}>Versioned product management. Barcode scanning and offline catalog sync arrive in later Merchant sprints.</Text>

        {outletIds.length > 1 ? (
          <View style={styles.rowWrap}>
            {outletIds.map((id) => (
              <Pressable key={id} accessibilityRole="button" onPress={() => void chooseOutlet(id)} style={styles.chip}>
                <Text>{id === outletId ? `✓ ${id.slice(0, 8)}` : id.slice(0, 8)}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {!outletId && !loading ? <Text accessibilityRole="alert">No authorized Merchant outlet is available.</Text> : null}
        {!canWrite && outletId ? <Text style={styles.notice}>Read only: CATALOG_WRITE is not currently granted for this outlet.</Text> : null}
        {message ? <Text accessibilityRole="alert" style={styles.notice}>{message}</Text> : null}

        {outletId ? (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Find listings</Text>
              <TextInput value={query} onChangeText={setQuery} placeholder="Name, category, brand or SKU" style={styles.input} accessibilityLabel="Catalog search" />
              <View style={styles.rowWrap}>
                {(['ALL', 'ACTIVE', 'INACTIVE'] as StatusFilter[]).map((value) => (
                  <Pressable key={value} accessibilityRole="button" onPress={() => setStatus(value)} style={styles.chip}>
                    <Text>{status === value ? `✓ ${value}` : value}</Text>
                  </Pressable>
                ))}
              </View>
              <Button title="Search" onPress={() => void loadPage(outletId, 0)} disabled={loading} />
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{editing ? `Edit ${editing.name}` : 'Create listing'}</Text>
              {!editing ? (
                <>
                  <Text style={styles.label}>Listing kind</Text>
                  <View style={styles.rowWrap}>
                    {(['PRODUCT', 'MEDICINE'] as ListingKind[]).map((value) => (
                      <Pressable key={value} accessibilityRole="button" onPress={() => updateForm('kind', value)} style={styles.chip}>
                        <Text>{form.kind === value ? `✓ ${value}` : value}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <Text style={styles.label}>Barcode type</Text>
                  <View style={styles.rowWrap}>
                    {(['INTERNAL', 'GTIN_13'] as BarcodeType[]).map((value) => (
                      <Pressable key={value} accessibilityRole="button" onPress={() => updateForm('barcodeType', value)} style={styles.chip}>
                        <Text>{form.barcodeType === value ? `✓ ${value}` : value}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <TextInput value={form.barcode} onChangeText={(value) => updateForm('barcode', value)} placeholder="Barcode or internal code" style={styles.input} />
                </>
              ) : (
                <Text style={styles.body}>Identity: {editing.kind} · {editing.barcodeType} · {editing.normalizedBarcode}</Text>
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
              <Button title={saving ? 'Saving…' : editing ? 'Save versioned update' : 'Create listing'} disabled={saving || !canWrite} onPress={() => void save()} />
              {editing ? <Button title="Cancel edit" disabled={saving} onPress={startCreate} /> : null}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Listings</Text>
              {loading ? <Text accessibilityLiveRegion="polite">Loading catalog…</Text> : null}
              {!loading && items.length === 0 ? <Text>No listings match this view.</Text> : null}
              {items.map((listing) => (
                <View key={listing.id} style={styles.card}>
                  <Text style={styles.cardTitle}>{listing.name}</Text>
                  <Text>{listing.status} · v{listing.version} · {listing.commerceMode}</Text>
                  <Text>₹{(listing.sellingPricePaise / 100).toFixed(2)} · MRP ₹{(listing.mrpPaise / 100).toFixed(2)}</Text>
                  <Text>{listing.category}{listing.sku ? ` · SKU ${listing.sku}` : ''}</Text>
                  <View style={styles.rowWrap}>
                    <Button title="Edit" disabled={!canWrite || saving} onPress={() => startEdit(listing)} />
                    <Button title={listing.status === 'ACTIVE' ? 'Deactivate' : 'Activate'} disabled={!canWrite || saving} onPress={() => void toggleStatus(listing)} />
                  </View>
                </View>
              ))}
              <View style={styles.rowWrap}>
                <Button title="Previous" disabled={loading || page === 0} onPress={() => outletId && void loadPage(outletId, page - 1)} />
                <Text>Page {page + 1}</Text>
                <Button title="Next" disabled={loading || !hasNext} onPress={() => outletId && void loadPage(outletId, page + 1)} />
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
