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
  fetchCatalogPage,
  fetchMerchantCatalogContext,
  type MerchantListing,
} from '../src/catalog/api';
import {
  createInventoryAdjustmentCommand,
  fetchInventoryBalance,
  fetchInventoryMovements,
  type InventoryAdjustmentCommand,
  type InventoryAdjustmentReason,
  type InventoryBalance,
  type InventoryMovement,
  submitInventoryAdjustment,
} from '../src/inventory/api';

type Direction = 'INCREASE' | 'DECREASE';

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'Inventory request failed. Retry safely.';
  switch (error.name) {
    case 'MERCHANT_PERMISSION_REQUIRED':
      return 'Inventory write permission is required for this outlet.';
    case 'RESOURCE_NOT_FOUND':
      return 'This listing or outlet is unavailable to your current Merchant access.';
    case 'SESSION_INVALID':
      return 'Your Merchant session is no longer active. Sign in again.';
    case 'INSUFFICIENT_STOCK':
      return 'This adjustment would make available stock negative.';
    case 'IDEMPOTENCY_FINGERPRINT_MISMATCH':
      return 'This inventory command key is already bound to different inputs. Start a new adjustment.';
    case 'INVENTORY_QUANTITY_INVALID':
      return 'Enter a valid whole-unit inventory quantity.';
    default:
      return error.message || 'Inventory request failed. Retry safely.';
  }
}

function hasInventoryWrite(permissions: string[] | undefined): boolean {
  return permissions?.some((permission) => permission === 'OWNER' || permission === 'INVENTORY_WRITE') ?? false;
}

function movementSummary(movement: InventoryMovement): string {
  const sign = movement.quantityDelta > 0 ? '+' : '';
  return `${movement.reason} ${sign}${movement.quantityDelta} → on hand ${movement.resultingOnHand}`;
}

export default function MerchantInventoryScreen() {
  const [outletIds, setOutletIds] = useState<string[]>([]);
  const [permissionsByOutlet, setPermissionsByOutlet] = useState<Record<string, string[]>>({});
  const [outletId, setOutletId] = useState<string | null>(null);
  const [listings, setListings] = useState<MerchantListing[]>([]);
  const [listing, setListing] = useState<MerchantListing | null>(null);
  const [balance, setBalance] = useState<InventoryBalance | null>(null);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [historyPage, setHistoryPage] = useState(0);
  const [historyHasNext, setHistoryHasNext] = useState(false);
  const [direction, setDirection] = useState<Direction>('INCREASE');
  const [quantity, setQuantity] = useState('1');
  const [reference, setReference] = useState('');
  const [pendingCommand, setPendingCommand] = useState<InventoryAdjustmentCommand | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const canWrite = useMemo(
    () => (outletId ? hasInventoryWrite(permissionsByOutlet[outletId]) : false),
    [outletId, permissionsByOutlet],
  );

  const loadInventory = useCallback(async (selectedOutlet: string, selectedListing: MerchantListing, page = 0) => {
    setLoading(true);
    setMessage('');
    try {
      const [nextBalance, history] = await Promise.all([
        fetchInventoryBalance(selectedOutlet, selectedListing.id),
        fetchInventoryMovements(selectedOutlet, selectedListing.id, page, 25),
      ]);
      setBalance(nextBalance);
      setMovements(history.items);
      setHistoryPage(history.page);
      setHistoryHasNext(history.hasNext);
    } catch (error) {
      setBalance(null);
      setMovements([]);
      setMessage(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadOutlet = useCallback(async (selectedOutlet: string) => {
    setLoading(true);
    setMessage('');
    setPendingCommand(null);
    try {
      const page = await fetchCatalogPage(selectedOutlet, { page: 0, pageSize: 50 });
      setListings(page.items);
      const first = page.items[0] ?? null;
      setListing(first);
      if (first) await loadInventory(selectedOutlet, first, 0);
      else {
        setBalance(null);
        setMovements([]);
      }
    } catch (error) {
      setListings([]);
      setListing(null);
      setBalance(null);
      setMovements([]);
      setMessage(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [loadInventory]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const context = await fetchMerchantCatalogContext();
        if (!active) return;
        setOutletIds(context.outletIds);
        setPermissionsByOutlet(context.permissionsByOutlet);
        const firstOutlet = context.outletIds[0] ?? null;
        setOutletId(firstOutlet);
        if (firstOutlet) await loadOutlet(firstOutlet);
      } catch (error) {
        if (active) setMessage(errorMessage(error));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [loadOutlet]);

  async function selectOutlet(nextOutletId: string) {
    if (saving) return;
    setOutletId(nextOutletId);
    await loadOutlet(nextOutletId);
  }

  async function selectListing(nextListing: MerchantListing) {
    if (!outletId || saving) return;
    setListing(nextListing);
    setPendingCommand(null);
    await loadInventory(outletId, nextListing, 0);
  }

  function buildCommand(): InventoryAdjustmentCommand | null {
    if (!outletId || !listing) return null;
    const units = Number(quantity);
    if (!Number.isSafeInteger(units) || units <= 0) {
      setMessage('Enter a positive whole-unit quantity.');
      return null;
    }
    const reason: InventoryAdjustmentReason = direction === 'INCREASE' ? 'MANUAL_INCREASE' : 'MANUAL_DECREASE';
    const quantityDelta = direction === 'INCREASE' ? units : -units;
    const note = reference.trim();
    return createInventoryAdjustmentCommand({
      outletId,
      listingId: listing.id,
      quantityDelta,
      reason,
      ...(note ? { referenceType: 'MERCHANT_NOTE', referenceId: note } : {}),
    });
  }

  async function execute(command: InventoryAdjustmentCommand) {
    if (!outletId || !listing || saving || !canWrite) return;
    setSaving(true);
    setMessage('');
    try {
      await submitInventoryAdjustment(command);
      setPendingCommand(null);
      setReference('');
      setMessage('Inventory movement committed.');
      await loadInventory(outletId, listing, 0);
    } catch (error) {
      // Retain the exact command key across an ambiguous network failure. A retry sends the same
      // command identity, allowing the server to return its canonical receipt without double stock.
      setPendingCommand(command);
      setMessage(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function submitNewAdjustment() {
    if (pendingCommand) {
      setMessage('Retry or discard the pending inventory command before starting another adjustment.');
      return;
    }
    const command = buildCommand();
    if (command) await execute(command);
  }

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Inventory</Text>
        <Text style={styles.body}>Server-authoritative stock. Each accepted change is an immutable ledger movement.</Text>

        {outletIds.length > 1 ? (
          <View style={styles.rowWrap}>
            {outletIds.map((id) => (
              <Pressable key={id} accessibilityRole="button" onPress={() => void selectOutlet(id)} style={styles.chip}>
                <Text>{id === outletId ? `Selected ${id.slice(0, 8)}` : id.slice(0, 8)}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {!canWrite && outletId ? (
          <Text accessibilityRole="alert" style={styles.notice}>Inventory write permission is not available for this outlet.</Text>
        ) : null}
        {message ? <Text accessibilityRole="alert" style={styles.notice}>{message}</Text> : null}
        {loading ? <Text accessibilityLiveRegion="polite">Loading inventory…</Text> : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Listing</Text>
          {listings.length === 0 && !loading ? <Text>No catalog listings are available for this outlet.</Text> : null}
          <View style={styles.rowWrap}>
            {listings.map((item) => (
              <Pressable key={item.id} accessibilityRole="button" onPress={() => void selectListing(item)} style={styles.chip}>
                <Text>{item.id === listing?.id ? `Selected: ${item.name}` : item.name}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {listing ? (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{listing.name}</Text>
              <Text style={styles.balance}>On hand: {balance?.onHand ?? '—'}</Text>
              <Text>Reserved: {balance?.reserved ?? '—'}</Text>
              <Text>Available: {balance?.available ?? '—'}</Text>
              <Button title="Refresh balance" disabled={loading || saving} onPress={() => outletId && void loadInventory(outletId, listing, 0)} />
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Adjustment</Text>
              <View style={styles.rowWrap}>
                {(['INCREASE', 'DECREASE'] as Direction[]).map((value) => (
                  <Pressable
                    key={value}
                    accessibilityRole="button"
                    disabled={saving || pendingCommand !== null}
                    onPress={() => setDirection(value)}
                    style={styles.chip}
                  >
                    <Text>{value === direction ? `Selected ${value.toLowerCase()}` : value.toLowerCase()}</Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                value={quantity}
                onChangeText={setQuantity}
                keyboardType="number-pad"
                placeholder="Whole units"
                accessibilityLabel="Inventory adjustment quantity"
                editable={!saving && pendingCommand === null}
                style={styles.input}
              />
              <TextInput
                value={reference}
                onChangeText={setReference}
                placeholder="Reference note (optional)"
                accessibilityLabel="Inventory adjustment reference"
                editable={!saving && pendingCommand === null}
                style={styles.input}
              />
              <Button
                title={saving ? 'Committing…' : 'Commit movement'}
                disabled={saving || !canWrite || pendingCommand !== null}
                onPress={() => void submitNewAdjustment()}
              />
              {pendingCommand ? (
                <View style={styles.retryBox}>
                  <Text accessibilityRole="alert">A prior response was not confirmed. Retry preserves the same command key.</Text>
                  <Button title="Retry same command" disabled={saving} onPress={() => void execute(pendingCommand)} />
                  <Button title="Discard pending retry" disabled={saving} onPress={() => setPendingCommand(null)} />
                </View>
              ) : null}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Movement history</Text>
              {movements.length === 0 && !loading ? <Text>No inventory movements yet.</Text> : null}
              {movements.map((movement) => (
                <View key={movement.id} style={styles.card}>
                  <Text style={styles.cardTitle}>{movementSummary(movement)}</Text>
                  <Text>{movement.sourceType || 'INVENTORY'} · {movement.sourceReference}</Text>
                  <Text>{new Date(movement.occurredAt).toLocaleString()}</Text>
                </View>
              ))}
              <View style={styles.rowWrap}>
                <Button
                  title="Previous"
                  disabled={loading || historyPage === 0}
                  onPress={() => outletId && void loadInventory(outletId, listing, historyPage - 1)}
                />
                <Text>Page {historyPage + 1}</Text>
                <Button
                  title="Next"
                  disabled={loading || !historyHasNext}
                  onPress={() => outletId && void loadInventory(outletId, listing, historyPage + 1)}
                />
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
  balance: { fontSize: 20, fontWeight: '800' },
  input: { minHeight: 46, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  chip: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  retryBox: { gap: 8, padding: 12, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10 },
  card: { gap: 6, padding: 12, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10 },
  cardTitle: { fontWeight: '800' },
});
