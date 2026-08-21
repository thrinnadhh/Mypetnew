import { useEffect, useState } from 'react';
import { Button, Pressable, SafeAreaView, ScrollView, Text, TextInput, View } from 'react-native';
import { fetchCatalogPage, fetchMerchantCatalogContext, type MerchantListing } from '../src/catalog/api';
import {
  createInventoryAdjustmentCommand,
  fetchInventoryBalance,
  fetchInventoryMovements,
  type InventoryAdjustmentCommand,
  type InventoryBalance,
  type InventoryMovement,
  submitInventoryAdjustment,
} from '../src/inventory/api';

function inventoryError(error: unknown): string {
  if (!(error instanceof Error)) return 'Inventory request failed.';
  if (error.name === 'MERCHANT_PERMISSION_REQUIRED') return 'Inventory write permission is required.';
  if (error.name === 'RESOURCE_NOT_FOUND') return 'This outlet or listing is unavailable.';
  if (error.name === 'SESSION_INVALID') return 'Your Merchant session is no longer active.';
  if (error.name === 'INSUFFICIENT_STOCK') return 'This adjustment would make stock negative.';
  return error.message || 'Inventory request failed.';
}

export default function MerchantInventoryScreen() {
  const [outletId, setOutletId] = useState<string | null>(null);
  const [canWrite, setCanWrite] = useState(false);
  const [listings, setListings] = useState<MerchantListing[]>([]);
  const [listing, setListing] = useState<MerchantListing | null>(null);
  const [balance, setBalance] = useState<InventoryBalance | null>(null);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [quantity, setQuantity] = useState('1');
  const [decrease, setDecrease] = useState(false);
  const [pending, setPending] = useState<InventoryAdjustmentCommand | null>(null);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');

  async function loadInventory(selectedOutlet: string, selectedListing: MerchantListing) {
    const [nextBalance, history] = await Promise.all([
      fetchInventoryBalance(selectedOutlet, selectedListing.id),
      fetchInventoryMovements(selectedOutlet, selectedListing.id, 0, 25),
    ]);
    setBalance(nextBalance);
    setMovements(history.items);
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const context = await fetchMerchantCatalogContext();
        const selectedOutlet = context.outletIds[0];
        if (!active || !selectedOutlet) return;
        const permission = context.permissionsByOutlet[selectedOutlet] ?? [];
        setOutletId(selectedOutlet);
        setCanWrite(permission.includes('OWNER') || permission.includes('INVENTORY_WRITE'));
        const catalog = await fetchCatalogPage(selectedOutlet, { pageSize: 25 });
        if (!active) return;
        setListings(catalog.items);
        const selectedListing = catalog.items[0] ?? null;
        setListing(selectedListing);
        if (selectedListing) await loadInventory(selectedOutlet, selectedListing);
      } catch (error) {
        if (active) setMessage(inventoryError(error));
      } finally {
        if (active) setBusy(false);
      }
    })();
    return () => { active = false; };
  }, []);

  async function choose(next: MerchantListing) {
    if (!outletId || busy) return;
    setBusy(true);
    setPending(null);
    setListing(next);
    setMessage('');
    try { await loadInventory(outletId, next); } catch (error) { setMessage(inventoryError(error)); } finally { setBusy(false); }
  }

  async function execute(command: InventoryAdjustmentCommand) {
    if (!outletId || !listing || busy || !canWrite) return;
    setBusy(true);
    setMessage('');
    try {
      await submitInventoryAdjustment(command);
      setPending(null);
      await loadInventory(outletId, listing);
      setMessage('Inventory movement committed.');
    } catch (error) {
      setPending(command); // A retry must retain the exact logical command/idempotency key.
      setMessage(inventoryError(error));
    } finally {
      setBusy(false);
    }
  }

  async function adjust() {
    if (!outletId || !listing || pending) return;
    const units = Number(quantity);
    if (!Number.isSafeInteger(units) || units <= 0) { setMessage('Enter a positive whole-unit quantity.'); return; }
    await execute(createInventoryAdjustmentCommand({
      outletId,
      listingId: listing.id,
      quantityDelta: decrease ? -units : units,
      reason: decrease ? 'MANUAL_DECREASE' : 'MANUAL_INCREASE',
    }));
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
        <Text style={{ fontSize: 28, fontWeight: '800' }}>Inventory</Text>
        <Text>Canonical stock is changed only by immutable ledger movements.</Text>
        {busy ? <Text accessibilityLiveRegion="polite">Loading inventory…</Text> : null}
        {message ? <Text accessibilityRole="alert">{message}</Text> : null}
        {!canWrite && outletId ? <Text accessibilityRole="alert">Inventory write permission is not available for this outlet.</Text> : null}

        <Text style={{ fontWeight: '800' }}>Listings</Text>
        <View style={{ gap: 8 }}>
          {listings.map((item) => (
            <Pressable key={item.id} accessibilityRole="button" onPress={() => void choose(item)}>
              <Text>{item.id === listing?.id ? `Selected: ${item.name}` : item.name}</Text>
            </Pressable>
          ))}
        </View>

        {listing ? <>
          <Text style={{ fontSize: 18, fontWeight: '800' }}>{listing.name}</Text>
          <Text>On hand: {balance?.onHand ?? '—'} · Reserved: {balance?.reserved ?? '—'} · Available: {balance?.available ?? '—'}</Text>
          <TextInput value={quantity} onChangeText={setQuantity} keyboardType="number-pad" accessibilityLabel="Inventory adjustment quantity" placeholder="Whole units" />
          <Button title={decrease ? 'Mode: decrease' : 'Mode: increase'} disabled={busy || pending !== null} onPress={() => setDecrease((value) => !value)} />
          <Button title="Commit movement" disabled={busy || !canWrite || pending !== null} onPress={() => void adjust()} />
          {pending ? <View>
            <Text accessibilityRole="alert">Previous result was not confirmed. Retry keeps the same command key.</Text>
            <Button title="Retry same command" disabled={busy} onPress={() => void execute(pending)} />
            <Button title="Discard retry" disabled={busy} onPress={() => setPending(null)} />
          </View> : null}
          <Text style={{ fontWeight: '800' }}>Recent movements</Text>
          {movements.map((movement) => <Text key={movement.id}>{movement.reason}: {movement.quantityDelta > 0 ? '+' : ''}{movement.quantityDelta} → {movement.resultingOnHand}</Text>)}
        </> : !busy ? <Text>No catalog listings are available.</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}
