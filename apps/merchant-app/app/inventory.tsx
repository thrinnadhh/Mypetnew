import { useEffect, useState } from 'react';
import { Button, SafeAreaView, ScrollView, Text, TextInput } from 'react-native';
import { fetchCatalogPage, fetchMerchantCatalogContext, type MerchantListing } from '../src/catalog/api';
import { createInventoryAdjustmentCommand, fetchInventoryBalance, fetchInventoryMovements, submitInventoryAdjustment, type InventoryAdjustmentCommand, type InventoryBalance, type InventoryMovement } from '../src/inventory/api';

export default function MerchantInventoryScreen() {
  const [outletId, setOutletId] = useState<string>();
  const [listing, setListing] = useState<MerchantListing>();
  const [balance, setBalance] = useState<InventoryBalance>();
  const [history, setHistory] = useState<InventoryMovement[]>([]);
  const [units, setUnits] = useState('1');
  const [decrease, setDecrease] = useState(false);
  const [canWrite, setCanWrite] = useState(false);
  const [pending, setPending] = useState<InventoryAdjustmentCommand>();
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');

  async function refresh(outlet: string, item: MerchantListing) {
    const [stock, movements] = await Promise.all([
      fetchInventoryBalance(outlet, item.id),
      fetchInventoryMovements(outlet, item.id, 0, 25),
    ]);
    setBalance(stock);
    setHistory(movements.items);
  }

  useEffect(() => {
    void (async () => {
      try {
        const context = await fetchMerchantCatalogContext();
        const outlet = context.outletIds[0];
        if (!outlet) return;
        setOutletId(outlet);
        const permissions = context.permissionsByOutlet[outlet] ?? [];
        setCanWrite(permissions.includes('OWNER') || permissions.includes('INVENTORY_WRITE'));
        const item = (await fetchCatalogPage(outlet, { pageSize: 1 })).items[0];
        if (!item) return;
        setListing(item);
        await refresh(outlet, item);
      } catch (error) { setMessage(error instanceof Error ? error.message : 'Inventory unavailable.'); }
      finally { setBusy(false); }
    })();
  }, []);

  async function commit(command: InventoryAdjustmentCommand) {
    if (!outletId || !listing || busy || !canWrite) return;
    setBusy(true);
    try {
      await submitInventoryAdjustment(command);
      setPending(undefined);
      await refresh(outletId, listing);
      setMessage('Inventory movement committed.');
    } catch (error) {
      setPending(command); // Network retry keeps this exact command key; it never creates a second key.
      setMessage(error instanceof Error ? error.message : 'Inventory update failed.');
    } finally { setBusy(false); }
  }

  async function adjust() {
    if (!outletId || !listing || pending) return;
    const quantity = Number(units);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) { setMessage('Use a positive whole-unit quantity.'); return; }
    await commit(createInventoryAdjustmentCommand({ outletId, listingId: listing.id, quantityDelta: decrease ? -quantity : quantity, reason: decrease ? 'MANUAL_DECREASE' : 'MANUAL_INCREASE' }));
  }

  return <SafeAreaView style={{ flex: 1, padding: 20 }}><ScrollView contentContainerStyle={{ gap: 12 }}>
    <Text style={{ fontSize: 28, fontWeight: '800' }}>Inventory</Text>
    <Text>Immutable movement ledger · canonical server balance</Text>
    {busy ? <Text>Loading…</Text> : null}{message ? <Text accessibilityRole="alert">{message}</Text> : null}
    {!canWrite && outletId ? <Text accessibilityRole="alert">Inventory write permission is required.</Text> : null}
    {listing ? <>
      <Text style={{ fontWeight: '800' }}>{listing.name}</Text>
      <Text>On hand {balance?.onHand ?? '—'} · Reserved {balance?.reserved ?? '—'} · Available {balance?.available ?? '—'}</Text>
      <TextInput accessibilityLabel="Inventory quantity" keyboardType="number-pad" value={units} onChangeText={setUnits} />
      <Button title={decrease ? 'Decrease mode' : 'Increase mode'} disabled={busy || !!pending} onPress={() => setDecrease((value) => !value)} />
      <Button title="Commit movement" disabled={busy || !canWrite || !!pending} onPress={() => void adjust()} />
      {pending ? <><Text>Previous response is uncertain; retry preserves its command key.</Text><Button title="Retry same command" disabled={busy} onPress={() => void commit(pending)} /><Button title="Discard retry" disabled={busy} onPress={() => setPending(undefined)} /></> : null}
      <Text style={{ fontWeight: '800' }}>Recent movements</Text>
      {history.map((movement) => <Text key={movement.id}>{movement.reason} {movement.quantityDelta > 0 ? '+' : ''}{movement.quantityDelta} → {movement.resultingOnHand}</Text>)}
    </> : !busy ? <Text>No catalog listing is available.</Text> : null}
  </ScrollView></SafeAreaView>;
}
