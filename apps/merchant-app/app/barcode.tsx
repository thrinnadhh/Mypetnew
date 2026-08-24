import { useEffect, useMemo, useState } from 'react';
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
import { resolveMerchantBarcode, type BarcodeResolution } from '../src/barcode/api';
import { normalizeMerchantBarcode } from '../src/barcode/model';
import { fetchMerchantCatalogContext, type BarcodeType } from '../src/catalog/api';
import { canWriteCatalog, catalogErrorMessage, catalogOutletLabel, catalogSelectedLabel } from '../src/catalog/model';

const BARCODE_TYPES: BarcodeType[] = ['GTIN_8', 'GTIN_12', 'GTIN_13', 'GTIN_14', 'INTERNAL'];

export default function MerchantBarcodeScreen() {
  const [outletIds, setOutletIds] = useState<string[]>([]);
  const [permissions, setPermissions] = useState<Record<string, string[]>>({});
  const [outletId, setOutletId] = useState<string | null>(null);
  const [barcodeType, setBarcodeType] = useState<BarcodeType>('GTIN_13');
  const [barcode, setBarcode] = useState('');
  const [resolution, setResolution] = useState<BarcodeResolution | null>(null);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState(false);
  const [message, setMessage] = useState('');

  const canResolve = useMemo(() => canWriteCatalog(permissions, outletId), [outletId, permissions]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const context = await fetchMerchantCatalogContext();
        if (!active) return;
        setOutletIds(context.outletIds);
        setPermissions(context.permissionsByOutlet);
        setOutletId(context.outletIds[0] ?? null);
      } catch (error) {
        if (active) setMessage(catalogErrorMessage(error));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function resolve() {
    if (!outletId || !canResolve || resolving) return;
    setResolving(true);
    setResolution(null);
    setMessage('');
    try {
      const normalized = normalizeMerchantBarcode(barcodeType, barcode);
      const result = await resolveMerchantBarcode(outletId, barcodeType, normalized);
      setResolution(result);
      setBarcode(result.normalizedBarcode);
      setMessage(result.listing ? 'Existing listing found in this outlet.' : 'Barcode is valid and currently unused in this outlet.');
    } catch (error) {
      setMessage(catalogErrorMessage(error));
    } finally {
      setResolving(false);
    }
  }

  function chooseOutlet(nextOutletId: string) {
    setOutletId(nextOutletId);
    setResolution(null);
    setMessage('');
  }

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Barcode lookup</Text>
        <Text style={styles.body}>
          Validate and resolve a barcode inside the selected Merchant outlet. Manual entry remains available even when camera access is unavailable.
        </Text>

        {outletIds.length > 1 ? (
          <View style={styles.rowWrap}>
            {outletIds.map((id) => (
              <Pressable key={id} accessibilityRole="button" onPress={() => chooseOutlet(id)} style={styles.chip}>
                <Text>{catalogOutletLabel(id, outletId)}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {!loading && !outletId ? <Text accessibilityRole="alert">No authorized Merchant outlet is available.</Text> : null}
        {!loading && outletId && !canResolve ? (
          <Text accessibilityRole="alert">CATALOG_WRITE permission is required to resolve barcodes for this outlet.</Text>
        ) : null}

        <Text style={styles.label}>Barcode type</Text>
        <View style={styles.rowWrap}>
          {BARCODE_TYPES.map((type) => (
            <Pressable
              key={type}
              accessibilityRole="button"
              onPress={() => {
                setBarcodeType(type);
                setResolution(null);
                setMessage('');
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
            setResolution(null);
          }}
          autoCapitalize={barcodeType === 'INTERNAL' ? 'characters' : 'none'}
          keyboardType={barcodeType === 'INTERNAL' ? 'default' : 'number-pad'}
          placeholder="Scan result or manual barcode"
          accessibilityLabel="Barcode value"
          style={styles.input}
        />
        <Button
          title={resolving ? 'Resolving…' : 'Resolve barcode'}
          disabled={loading || resolving || !outletId || !canResolve || barcode.trim().length === 0}
          onPress={() => void resolve()}
        />

        {message ? <Text accessibilityRole="alert" style={styles.notice}>{message}</Text> : null}
        {resolution?.listing ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{resolution.listing.name}</Text>
            <Text>{resolution.listing.kind} · {resolution.listing.status}</Text>
            <Text>{resolution.barcodeType} · {resolution.normalizedBarcode}</Text>
            <Text>Listing ID: {resolution.listing.id}</Text>
          </View>
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
  label: { fontSize: 13, fontWeight: '700' },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  chip: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  input: { minHeight: 46, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  notice: { padding: 12, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10 },
  card: { gap: 7, padding: 14, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12 },
  cardTitle: { fontSize: 16, fontWeight: '800' },
});
