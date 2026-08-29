import { useEffect, useState } from 'react';
import { Button, SafeAreaView, ScrollView, Text, TextInput, View } from 'react-native';
import { fetchCatalogPage, fetchMerchantCatalogContext, type MerchantListing } from '../src/catalog/api';
import {
  createInventoryAdjustmentCommand,
  fetchInventoryBalance,
  fetchInventoryMovements,
  startStockCount,
  submitDamage,
  submitExpiry,
  submitInventoryAdjustment,
  submitReceiving,
  submitReturn,
  submitShrinkage,
  submitStockCount,
  submitTransfer,
  updateStockCountLines,
  type InventoryAdjustmentCommand,
  type InventoryBalance,
  type InventoryCountSession,
  type InventoryMovement,
} from '../src/inventory/api';

export type InventoryOpMode =
  | 'ADJUSTMENT'
  | 'RECEIVING'
  | 'DAMAGE'
  | 'EXPIRY'
  | 'SHRINKAGE'
  | 'RETURN'
  | 'TRANSFER'
  | 'COUNT';

export type OfflineSyncStatus =
  | 'Saved locally'
  | 'Pending sync'
  | 'Syncing'
  | 'Applied'
  | 'Rejected'
  | 'Needs review';

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
  const [opMode, setOpMode] = useState<InventoryOpMode>('ADJUSTMENT');
  const [syncStatus, setSyncStatus] = useState<OfflineSyncStatus>('Applied');

  // M8 operation form state
  const [refType, setRefType] = useState('');
  const [refId, setRefId] = useState('');
  const [batchNo, setBatchNo] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [destOutletId, setDestOutletId] = useState('');
  const [returnType, setReturnType] = useState<'CUSTOMER_RETURN' | 'VENDOR_RETURN'>('CUSTOMER_RETURN');

  // Stock count session state
  const [countSession, setCountSession] = useState<InventoryCountSession>();
  const [countedQty, setCountedQty] = useState('0');

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
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Inventory unavailable.');
      } finally {
        setBusy(false);
      }
    })();
  }, []);

  async function commit(command: InventoryAdjustmentCommand) {
    if (!outletId || !listing || busy || !canWrite) return;
    setBusy(true);
    setSyncStatus('Syncing');
    try {
      await submitInventoryAdjustment(command);
      setPending(undefined);
      setSyncStatus('Applied');
      await refresh(outletId, listing);
      setMessage('Inventory movement committed.');
    } catch (error) {
      setPending(command);
      setSyncStatus('Pending sync');
      setMessage(error instanceof Error ? error.message : 'Inventory update failed.');
    } finally {
      setBusy(false);
    }
  }

  async function adjust() {
    if (!outletId || !listing || pending) return;
    const quantity = Number(units);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      setMessage('Use a positive whole-unit quantity.');
      return;
    }
    await commit(
      createInventoryAdjustmentCommand({
        outletId,
        listingId: listing.id,
        quantityDelta: decrease ? -quantity : quantity,
        reason: decrease ? 'MANUAL_DECREASE' : 'MANUAL_INCREASE',
      }),
    );
  }

  async function handleReceiving() {
    if (!outletId || !listing || !canWrite) return;
    const quantity = Number(units);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      setMessage('Use a positive whole-unit quantity.');
      return;
    }
    setBusy(true);
    try {
      await submitReceiving({
        outletId,
        listingId: listing.id,
        quantity,
        referenceType: refType || undefined,
        referenceId: refId || undefined,
        batchNumber: batchNo || undefined,
        expiryDate: expiryDate || undefined,
      });
      setSyncStatus('Applied');
      await refresh(outletId, listing);
      setMessage('Receiving recorded successfully.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Receiving failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDamage() {
    if (!outletId || !listing || !canWrite) return;
    const quantity = Number(units);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      setMessage('Use a positive whole-unit quantity.');
      return;
    }
    setBusy(true);
    try {
      await submitDamage({
        outletId,
        listingId: listing.id,
        quantity,
        reasonDetails: refType || undefined,
        referenceId: refId || undefined,
      });
      setSyncStatus('Applied');
      await refresh(outletId, listing);
      setMessage('Damage recorded successfully.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Damage recording failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleExpiry() {
    if (!outletId || !listing || !canWrite) return;
    const quantity = Number(units);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      setMessage('Use a positive whole-unit quantity.');
      return;
    }
    setBusy(true);
    try {
      await submitExpiry({
        outletId,
        listingId: listing.id,
        quantity,
        batchReference: batchNo || undefined,
        expiryDate: expiryDate || undefined,
      });
      setSyncStatus('Applied');
      await refresh(outletId, listing);
      setMessage('Expiry recorded successfully.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Expiry recording failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleShrinkage() {
    if (!outletId || !listing || !canWrite) return;
    const quantity = Number(units);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      setMessage('Use a positive whole-unit quantity.');
      return;
    }
    setBusy(true);
    try {
      await submitShrinkage({
        outletId,
        listingId: listing.id,
        quantity,
        notes: refType || undefined,
        referenceId: refId || undefined,
      });
      setSyncStatus('Applied');
      await refresh(outletId, listing);
      setMessage('Shrinkage recorded successfully.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Shrinkage recording failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleReturn() {
    if (!outletId || !listing || !canWrite) return;
    const quantity = Number(units);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      setMessage('Use a positive whole-unit quantity.');
      return;
    }
    setBusy(true);
    try {
      await submitReturn({
        outletId,
        listingId: listing.id,
        quantity,
        returnType,
        referenceType: refType || undefined,
        referenceId: refId || undefined,
      });
      setSyncStatus('Applied');
      await refresh(outletId, listing);
      setMessage('Return recorded successfully.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Return recording failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleTransfer() {
    if (!outletId || !listing || !canWrite || !destOutletId) {
      setMessage('Destination outlet ID is required.');
      return;
    }
    const quantity = Number(units);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      setMessage('Use a positive whole-unit quantity.');
      return;
    }
    setBusy(true);
    try {
      await submitTransfer({
        sourceOutletId: outletId,
        destinationOutletId: destOutletId,
        sourceListingId: listing.id,
        quantity,
      });
      setSyncStatus('Applied');
      await refresh(outletId, listing);
      setMessage('Transfer completed successfully.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Transfer failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleStartCount() {
    if (!outletId || !canWrite) return;
    setBusy(true);
    try {
      const session = await startStockCount(outletId);
      setCountSession(session);
      setMessage(`Count session started: ${session.id}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Starting count session failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleAddCountLine() {
    if (!outletId || !listing || !countSession) return;
    const qty = Number(countedQty);
    if (!Number.isSafeInteger(qty) || qty < 0) {
      setMessage('Counted quantity must be non-negative.');
      return;
    }
    setBusy(true);
    try {
      const updated = await updateStockCountLines(outletId, countSession.id, [
        { listingId: listing.id, countedQuantity: qty },
      ]);
      setCountSession(updated);
      setMessage('Count line saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Updating count line failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmitCount() {
    if (!outletId || !countSession) return;
    setBusy(true);
    try {
      const res = await submitStockCount(outletId, countSession.id);
      setMessage(`Count submitted. ${res.lines.length} lines reconciled.`);
      if (listing) await refresh(outletId, listing);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Count submission failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, padding: 20 }}>
      <ScrollView contentContainerStyle={{ gap: 12 }}>
        <Text style={{ fontSize: 28, fontWeight: '800' }}>Inventory</Text>
        <Text>Immutable movement ledger · canonical server balance</Text>
        <Text style={{ fontSize: 12, color: '#666' }}>Sync status: {syncStatus}</Text>
        {busy ? <Text>Loading…</Text> : null}
        {message ? <Text accessibilityRole="alert">{message}</Text> : null}
        {!canWrite && outletId ? (
          <Text accessibilityRole="alert">Inventory write permission is required.</Text>
        ) : null}
        {listing ? (
          <>
            <Text style={{ fontWeight: '800' }}>{listing.name}</Text>
            <Text>
              On hand {balance?.onHand ?? '—'} · Reserved {balance?.reserved ?? '—'} · Available{' '}
              {balance?.available ?? '—'}
            </Text>

            {/* Operation mode buttons */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {(['ADJUSTMENT', 'RECEIVING', 'DAMAGE', 'EXPIRY', 'SHRINKAGE', 'RETURN', 'TRANSFER', 'COUNT'] as const).map((mode) => (
                <Button
                  key={mode}
                  title={mode}
                  color={opMode === mode ? '#007AFF' : '#888888'}
                  onPress={() => setOpMode(mode)}
                />
              ))}
            </View>

            {opMode === 'ADJUSTMENT' && (
              <>
                <TextInput
                  accessibilityLabel="Inventory quantity"
                  keyboardType="number-pad"
                  value={units}
                  onChangeText={setUnits}
                />
                <Button
                  title={decrease ? 'Decrease mode' : 'Increase mode'}
                  disabled={busy || !!pending}
                  onPress={() => setDecrease((value) => !value)}
                />
                <Button
                  title="Commit movement"
                  disabled={busy || !canWrite || !!pending}
                  onPress={() => void adjust()}
                />
                {pending ? (
                  <>
                    <Text>Previous response is uncertain; retry preserves its command key.</Text>
                    <Button
                      title="Retry same command"
                      disabled={busy}
                      onPress={() => void commit(pending)}
                    />
                    <Button
                      title="Discard retry"
                      disabled={busy}
                      onPress={() => setPending(undefined)}
                    />
                  </>
                ) : null}
              </>
            )}

            {opMode === 'RECEIVING' && (
              <>
                <Text style={{ fontWeight: '600' }}>Stock Receiving</Text>
                <TextInput
                  placeholder="Units received"
                  keyboardType="number-pad"
                  value={units}
                  onChangeText={setUnits}
                />
                <TextInput
                  placeholder="Reference type (e.g. PO)"
                  value={refType}
                  onChangeText={setRefType}
                />
                <TextInput
                  placeholder="Reference ID"
                  value={refId}
                  onChangeText={setRefId}
                />
                <TextInput
                  placeholder="Batch number (optional)"
                  value={batchNo}
                  onChangeText={setBatchNo}
                />
                <TextInput
                  placeholder="Expiry date (optional YYYY-MM-DD)"
                  value={expiryDate}
                  onChangeText={setExpiryDate}
                />
                <Button
                  title="Record Receiving"
                  disabled={busy || !canWrite}
                  onPress={() => void handleReceiving()}
                />
              </>
            )}

            {opMode === 'DAMAGE' && (
              <>
                <Text style={{ fontWeight: '600' }}>Damaged Stock</Text>
                <TextInput
                  placeholder="Units damaged"
                  keyboardType="number-pad"
                  value={units}
                  onChangeText={setUnits}
                />
                <TextInput
                  placeholder="Reason / details"
                  value={refType}
                  onChangeText={setRefType}
                />
                <Button
                  title="Record Damage"
                  disabled={busy || !canWrite}
                  onPress={() => void handleDamage()}
                />
              </>
            )}

            {opMode === 'EXPIRY' && (
              <>
                <Text style={{ fontWeight: '600' }}>Expired Stock</Text>
                <TextInput
                  placeholder="Units expired"
                  keyboardType="number-pad"
                  value={units}
                  onChangeText={setUnits}
                />
                <TextInput
                  placeholder="Batch reference (optional)"
                  value={batchNo}
                  onChangeText={setBatchNo}
                />
                <Button
                  title="Record Expiry"
                  disabled={busy || !canWrite}
                  onPress={() => void handleExpiry()}
                />
              </>
            )}

            {opMode === 'SHRINKAGE' && (
              <>
                <Text style={{ fontWeight: '600' }}>Shrinkage</Text>
                <TextInput
                  placeholder="Units missing/shrunk"
                  keyboardType="number-pad"
                  value={units}
                  onChangeText={setUnits}
                />
                <TextInput
                  placeholder="Notes"
                  value={refType}
                  onChangeText={setRefType}
                />
                <Button
                  title="Record Shrinkage"
                  disabled={busy || !canWrite}
                  onPress={() => void handleShrinkage()}
                />
              </>
            )}

            {opMode === 'RETURN' && (
              <>
                <Text style={{ fontWeight: '600' }}>Stock Return</Text>
                <TextInput
                  placeholder="Units returned"
                  keyboardType="number-pad"
                  value={units}
                  onChangeText={setUnits}
                />
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Button
                    title="Customer Return (+)"
                    color={returnType === 'CUSTOMER_RETURN' ? '#007AFF' : '#888'}
                    onPress={() => setReturnType('CUSTOMER_RETURN')}
                  />
                  <Button
                    title="Vendor Return (-)"
                    color={returnType === 'VENDOR_RETURN' ? '#007AFF' : '#888'}
                    onPress={() => setReturnType('VENDOR_RETURN')}
                  />
                </View>
                <TextInput
                  placeholder="Reference ID"
                  value={refId}
                  onChangeText={setRefId}
                />
                <Button
                  title="Record Return"
                  disabled={busy || !canWrite}
                  onPress={() => void handleReturn()}
                />
              </>
            )}

            {opMode === 'TRANSFER' && (
              <>
                <Text style={{ fontWeight: '600' }}>Outlet Transfer</Text>
                <TextInput
                  placeholder="Transfer quantity"
                  keyboardType="number-pad"
                  value={units}
                  onChangeText={setUnits}
                />
                <TextInput
                  placeholder="Destination Outlet UUID"
                  value={destOutletId}
                  onChangeText={setDestOutletId}
                />
                <Button
                  title="Execute Transfer"
                  disabled={busy || !canWrite}
                  onPress={() => void handleTransfer()}
                />
              </>
            )}

            {opMode === 'COUNT' && (
              <>
                <Text style={{ fontWeight: '600' }}>Stock Count Session</Text>
                {!countSession ? (
                  <Button
                    title="Start New Count Session"
                    disabled={busy || !canWrite}
                    onPress={() => void handleStartCount()}
                  />
                ) : (
                  <>
                    <Text>Session ID: {countSession.id}</Text>
                    <Text>Status: {countSession.status}</Text>
                    <TextInput
                      placeholder="Counted physical quantity"
                      keyboardType="number-pad"
                      value={countedQty}
                      onChangeText={setCountedQty}
                    />
                    <Button
                      title="Save Count for Current Item"
                      disabled={busy || countSession.status !== 'OPEN'}
                      onPress={() => void handleAddCountLine()}
                    />
                    <Button
                      title="Submit Stock Count"
                      disabled={busy || countSession.status !== 'OPEN'}
                      onPress={() => void handleSubmitCount()}
                    />
                  </>
                )}
              </>
            )}

            <Text style={{ fontWeight: '800' }}>Recent movements</Text>
            {history.map((movement) => (
              <Text key={movement.id}>
                {movement.reason} {movement.quantityDelta > 0 ? '+' : ''}
                {movement.quantityDelta} → {movement.resultingOnHand}
              </Text>
            ))}
          </>
        ) : !busy ? (
          <Text>No catalog listing is available.</Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
