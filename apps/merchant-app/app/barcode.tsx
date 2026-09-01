import * as Crypto from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Platform,
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
import {
  completePosSale,
  findPosSaleByIdempotencyKey,
  resolveMerchantBarcode,
  type PosSaleResponse,
} from '../src/barcode/api';
import {
  BarcodeScannerView,
  PosCartView,
  ProductFoundCard,
  SaleConfirmationModal,
  SaleReceiptModal,
  StockConflictBanner,
  UnknownBarcodeCard,
  UnknownOutcomeBanner,
} from '../src/barcode/components';
import {
  BarcodeDebounceGate,
  normalizeMerchantBarcode,
  type AcceptedBarcode,
  type BarcodeInputSource,
  type ScannerPermissionState,
} from '../src/barcode/model';
import {
  addItemToCart,
  clearCart,
  createEmptyCart,
  removeItemFromCart,
  setCartCustomer,
  setCartPaymentDeclaration,
  updateItemQuantity,
  type CustomerSummary,
  type PaymentDeclaration,
  type PosCart,
} from '../src/barcode/pos-cart';
import {
  fetchMerchantCatalogContext,
  type BarcodeType,
  type ListingKind,
  type MerchantListing,
} from '../src/catalog/api';
import {
  catalogErrorMessage,
  catalogOutletLabel,
  catalogSelectedLabel,
} from '../src/catalog/model';
import { useMerchantDatabase } from '../src/data';
import type { CatalogDraft } from '../src/data/models/draft-types';
import {
  createPartitionContext,
  type MerchantPartitionContext,
} from '../src/data/models/partition-context';
import { CommandOutboxRepository } from '../src/data/repositories/command-outbox-repository';
import { PartitionDiscoveryRepository } from '../src/data/repositories/partition-discovery-repository';
import { colors } from '../src/design/tokens/colors';
import { radius } from '../src/design/tokens/radius';
import { spacing } from '../src/design/tokens/spacing';
import { typography } from '../src/design/tokens/typography';
import { fetchInventoryBalance } from '../src/inventory/api';
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

type ScreenMode = 'POS' | 'ONBOARDING';

export default function MerchantBarcodeScreen() {
  const { database, barcodeRepo, draftRepo, pendingMediaRepo } = useMerchantDatabase();
  const [partitions, setPartitions] = useState<MerchantPartitionContext[]>([]);
  const [activePartition, setActivePartition] = useState<MerchantPartitionContext | null>(null);
  const [onlineOutletIds, setOnlineOutletIds] = useState<string[]>([]);
  const [onlineOrganizationId, setOnlineOrganizationId] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(true);

  // Screen Mode: POS Sale vs Catalog Onboarding
  const [screenMode, setScreenMode] = useState<ScreenMode>('POS');

  // Scanner State
  const [permission, setPermission] = useState<ScannerPermissionState>('GRANTED');
  const [rapidScanMode, setRapidScanMode] = useState(true);
  const [torchOn, setTorchOn] = useState(false);
  const [barcodeType, setBarcodeType] = useState<BarcodeType>('GTIN_13');
  const [barcodeInput, setBarcodeInput] = useState('');
  const [lastScannedCode, setLastScannedCode] = useState<string | null>(null);
  const [showManualInput, setShowManualInput] = useState(false);

  // Resolution State
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState(false);
  const [resolvedListing, setResolvedListing] = useState<MerchantListing | null>(null);
  const [resolvedAvailableStock, setResolvedAvailableStock] = useState<number>(0);
  const [unknownBarcode, setUnknownBarcode] = useState<string | null>(null);
  const [draft, setDraft] = useState<CatalogDraft | null>(null);
  const [message, setMessage] = useState('');

  // POS Cart State
  const outletId = activePartition?.outletId ?? onlineOutletIds[0] ?? '';
  const [cart, setCart] = useState<PosCart>(() => createEmptyCart(outletId));

  // Checkout & Modals State
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [submittingSale, setSubmittingSale] = useState(false);
  const [completedSale, setCompletedSale] = useState<PosSaleResponse | null>(null);
  const [stockConflictMessage, setStockConflictMessage] = useState<string | null>(null);
  const [unknownOutcomeKey, setUnknownOutcomeKey] = useState<string | null>(null);
  const [checkingOutcome, setCheckingOutcome] = useState(false);
  const activeIdempotencyKeyRef = useRef<string | null>(null);

  // Draft Creation State
  const [draftName, setDraftName] = useState('');
  const [kind, setKind] = useState<ListingKind>('PRODUCT');
  const [mrp, setMrp] = useState('');
  const [sellingPrice, setSellingPrice] = useState('');
  const [category, setCategory] = useState('other');

  const debounceGate = useMemo(() => new BarcodeDebounceGate(1200), []);
  const canCreateOfflineDraft = Boolean(activePartition && draftRepo && database);
  const draftCommerceMode = useMemo(() => (kind === 'MEDICINE' ? 'VIEW_ONLY' : 'COMMERCE'), [kind]);

  // Initial Partition Discovery & Catalog Context
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
          setIsOnline(true);
          setOnlineOutletIds(remote.outletIds);
          setOnlineOrganizationId(remote.organizationId);
          if (accountId && remote.organizationId) {
            const remotePartitions = remote.outletIds.map((id) =>
              createPartitionContext(accountId, remote.organizationId!, id),
            );
            const unique = new Map<string, MerchantPartitionContext>();
            [...cached, ...remotePartitions].forEach((item) => unique.set(partitionKey(item), item));
            cached = [...unique.values()];
          }
        } catch {
          if (active) setIsOnline(false);
        }

        if (!active) return;
        setPartitions(cached);
        const initial = cached[0] ?? null;
        setActivePartition(initial);
        if (initial?.outletId) {
          setCart(createEmptyCart(initial.outletId));
        }
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

  const resetResolution = useCallback(() => {
    setResolvedListing(null);
    setResolvedAvailableStock(0);
    setDraft(null);
    setUnknownBarcode(null);
    setMessage('');
    setStockConflictMessage(null);
  }, []);

  // Request Camera Permission
  const requestCameraPermission = useCallback(async () => {
    setPermission('REQUESTING');
    try {
      if (Platform.OS === 'web') {
        setPermission('GRANTED');
      } else {
        const result = await ImagePicker.requestCameraPermissionsAsync();
        if (result.granted) {
          setPermission('GRANTED');
        } else if (result.canAskAgain) {
          setPermission('DENIED');
        } else {
          setPermission('BLOCKED');
        }
      }
    } catch {
      setPermission('UNAVAILABLE');
    }
  }, []);

  // Handle Scan or Manual Barcode Resolution
  const handleResolveBarcode = useCallback(
    async (
      type: BarcodeType,
      rawCode: string,
      source: BarcodeInputSource = 'MANUAL',
    ) => {
      if (!outletId || resolving) return;

      const accepted: AcceptedBarcode | null = debounceGate.accept(type, rawCode, source);
      if (!accepted && source === 'CAMERA') {
        // Suppressed duplicate callback within cooldown window
        return;
      }

      setResolving(true);
      resetResolution();
      try {
        const normalized = normalizeMerchantBarcode(type, rawCode);
        setBarcodeInput(normalized);
        setLastScannedCode(normalized);

        // Try local cache first if partition context is available
        if (activePartition && barcodeRepo && draftRepo) {
          const local = await barcodeRepo.processScanOffline(activePartition, type, normalized);
          if (local.found) {
            const stock = 10; // Cached default baseline
            setResolvedListing(local.listing);
            setResolvedAvailableStock(stock);
            setMessage('Existing listing resolved from local catalog cache.');

            if (rapidScanMode && screenMode === 'POS') {
              setCart((prev) =>
                addItemToCart(
                  prev,
                  {
                    listingId: local.listing.id,
                    name: local.listing.name,
                    barcodeType: local.listing.barcodeType,
                    normalizedBarcode: local.listing.normalizedBarcode,
                    mrpPaise: local.listing.mrpPaise,
                    sellingPricePaise: local.listing.sellingPricePaise,
                    availableStock: stock,
                  },
                  1,
                ),
              );
            }
            return;
          }
          if (local.ambiguous?.length) {
            setMessage('Multiple cached listings match this barcode. Refresh before making changes.');
            return;
          }
          const existingDraft = await draftRepo.findByBarcode(activePartition, type, normalized);
          if (existingDraft && existingDraft.status !== 'SYNCED') {
            setDraft(existingDraft);
            setMessage(`Local draft already exists (${existingDraft.status}).`);
            return;
          }
        }

        // Online Backend Barcode Resolution
        const online = await resolveMerchantBarcode(outletId, type, normalized);
        if (online.listing) {
          let stock = 10;
          try {
            const balance = await fetchInventoryBalance(outletId, online.listing.id);
            stock = balance.available;
          } catch {
            // Default to available if balance check fails
          }

          setResolvedListing(online.listing);
          setResolvedAvailableStock(stock);
          setMessage('Existing listing found in this outlet.');

          if (rapidScanMode && screenMode === 'POS') {
            setCart((prev) =>
              addItemToCart(
                prev,
                {
                  listingId: online.listing!.id,
                  name: online.listing!.name,
                  barcodeType: online.listing!.barcodeType,
                  normalizedBarcode: online.listing!.normalizedBarcode,
                  mrpPaise: online.listing!.mrpPaise,
                  sellingPricePaise: online.listing!.sellingPricePaise,
                  availableStock: stock,
                },
                1,
              ),
            );
          }
        } else {
          setUnknownBarcode(online.normalizedBarcode);
          setMessage('Unknown barcode. You can create a local-only draft and continue.');
        }
      } catch (error) {
        setMessage(catalogErrorMessage(error));
      } finally {
        setResolving(false);
      }
    },
    [
      activePartition,
      barcodeRepo,
      debounceGate,
      draftRepo,
      outletId,
      rapidScanMode,
      resetResolution,
      resolving,
      screenMode,
    ],
  );

  // Cart Operations
  const handleAddToCart = useCallback((listingItem: MerchantListing, availableStock: number) => {
    setCart((prev) =>
      addItemToCart(
        prev,
        {
          listingId: listingItem.id,
          name: listingItem.name,
          barcodeType: listingItem.barcodeType,
          normalizedBarcode: listingItem.normalizedBarcode,
          mrpPaise: listingItem.mrpPaise,
          sellingPricePaise: listingItem.sellingPricePaise,
          availableStock,
        },
        1,
      ),
    );
    setResolvedListing(null);
  }, []);

  const handleUpdateQuantity = useCallback((listingId: string, quantity: number) => {
    setCart((prev) => updateItemQuantity(prev, listingId, quantity));
  }, []);

  const handleRemoveItem = useCallback((listingId: string) => {
    setCart((prev) => removeItemFromCart(prev, listingId));
  }, []);

  const handleClearCart = useCallback(() => {
    setCart(clearCart(outletId));
    resetResolution();
  }, [outletId, resetResolution]);

  const handleSetCustomer = useCallback((customer: CustomerSummary) => {
    setCart((prev) => setCartCustomer(prev, customer));
  }, []);

  const handleSetPayment = useCallback((payment: PaymentDeclaration) => {
    setCart((prev) => setCartPaymentDeclaration(prev, payment));
  }, []);

  // Outlet Switching with Confirmation
  const choosePartition = useCallback(
    (next: MerchantPartitionContext) => {
      if (cart.items.length > 0 && next.outletId !== activePartition?.outletId) {
        Alert.alert(
          'Switch Outlet',
          'Switching outlets will clear the current POS cart to protect inventory isolation.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Switch & Clear Cart',
              style: 'destructive',
              onPress: () => {
                setActivePartition(next);
                setCart(createEmptyCart(next.outletId));
                resetResolution();
              },
            },
          ],
        );
      } else {
        setActivePartition(next);
        resetResolution();
      }
    },
    [activePartition?.outletId, cart.items.length, resetResolution],
  );

  // Complete POS Sale
  const handleConfirmSale = useCallback(async () => {
    if (!outletId || cart.items.length === 0 || submittingSale) return;
    setSubmittingSale(true);
    setStockConflictMessage(null);

    const idempotencyKey = activeIdempotencyKeyRef.current ?? `pos-sale:${await installationId()}:${Crypto.randomUUID()}`;
    activeIdempotencyKeyRef.current = idempotencyKey;

    try {
      const response = await completePosSale(
        {
          outletId,
          associationChallengeId: cart.customer.associationChallengeId ?? null,
          paymentDeclaration: cart.paymentDeclaration,
          lines: cart.items.map((item) => ({
            listingId: item.listingId,
            quantity: item.quantity,
          })),
        },
        idempotencyKey,
      );

      setCompletedSale(response);
      setShowConfirmModal(false);
      activeIdempotencyKeyRef.current = null;
      setUnknownOutcomeKey(null);
    } catch (error: any) {
      if (error?.name === 'LISTING_UNAVAILABLE' || error?.code === 'LISTING_UNAVAILABLE') {
        setStockConflictMessage('One or more items in the cart are no longer available in the requested quantity. Please check stock levels.');
      } else if (error?.name === 'IDEMPOTENCY_FINGERPRINT_MISMATCH') {
        setStockConflictMessage('Idempotency conflict: A different sale was submitted with this key.');
      } else if (
        error?.message?.includes('Network') ||
        error?.message?.includes('Failed to fetch') ||
        error?.message?.includes('Network request failed')
      ) {
        setUnknownOutcomeKey(idempotencyKey);
      } else {
        setMessage(catalogErrorMessage(error));
      }
    } finally {
      setSubmittingSale(false);
    }
  }, [cart, outletId, submittingSale]);

  // Reconcile Unknown Outcome
  const handleReconcileUnknownOutcome = useCallback(async () => {
    if (!outletId || !unknownOutcomeKey || checkingOutcome) return;
    setCheckingOutcome(true);
    try {
      const existing = await findPosSaleByIdempotencyKey(outletId, unknownOutcomeKey);
      if (existing) {
        setCompletedSale(existing);
        setUnknownOutcomeKey(null);
        activeIdempotencyKeyRef.current = null;
        setShowConfirmModal(false);
        setMessage('Sale was confirmed on server and has been recovered.');
      }
    } catch {
      setMessage('No record found on server for this sale key. You may safely retry checkout.');
      setUnknownOutcomeKey(null);
    } finally {
      setCheckingOutcome(false);
    }
  }, [checkingOutcome, outletId, unknownOutcomeKey]);

  const handleStartNewSale = useCallback(() => {
    setCompletedSale(null);
    setCart(createEmptyCart(outletId));
    resetResolution();
  }, [outletId, resetResolution]);

  // Create Offline Draft (Catalog Onboarding Mode)
  const createDraft = useCallback(async () => {
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
  }, [
    activePartition,
    barcodeType,
    category,
    database,
    draftName,
    draftRepo,
    kind,
    mrp,
    sellingPrice,
    unknownBarcode,
  ]);

  const syncNow = useCallback(async () => {
    if (!activePartition || !database) return;
    try {
      const summary = await new SyncCoordinator(database).sync(activePartition);
      if (draft && draftRepo) setDraft(await draftRepo.getDraft(activePartition, draft.localId));
      setMessage(`Sync processed ${summary.commandsProcessed} command(s); ${summary.acknowledged} acknowledged.`);
    } catch (error) {
      setMessage(catalogErrorMessage(error));
    }
  }, [activePartition, database, draft, draftRepo]);

  const currentItemInCartQuantity = useMemo(() => {
    if (!resolvedListing) return 0;
    return cart.items.find((i) => i.listingId === resolvedListing.id)?.quantity ?? 0;
  }, [cart.items, resolvedListing]);

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Header and Mode Selector */}
        <View style={styles.header}>
          <Text style={styles.title}>POS & Barcode Scanner</Text>
          <View style={styles.modeTabsRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Switch to POS Checkout mode"
              onPress={() => setScreenMode('POS')}
              style={[styles.modeTab, screenMode === 'POS' ? styles.modeTabActive : null]}
            >
              <Text style={[styles.modeTabText, screenMode === 'POS' ? styles.modeTabTextActive : null]}>
                POS Checkout
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Switch to Catalog Onboarding mode"
              onPress={() => setScreenMode('ONBOARDING')}
              style={[styles.modeTab, screenMode === 'ONBOARDING' ? styles.modeTabActive : null]}
            >
              <Text style={[styles.modeTabText, screenMode === 'ONBOARDING' ? styles.modeTabTextActive : null]}>
                Catalog Drafts
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Partition / Outlet Switcher */}
        {partitions.length > 1 ? (
          <View style={styles.partitionContainer}>
            <Text style={styles.subLabel}>Active Outlet Scope</Text>
            <View style={styles.rowWrap}>
              {partitions.map((partition) => (
                <Pressable
                  key={partitionKey(partition)}
                  accessibilityRole="button"
                  onPress={() => choosePartition(partition)}
                  style={[
                    styles.chip,
                    partition.outletId === activePartition?.outletId ? styles.chipSelected : null,
                  ]}
                >
                  <Text style={partition.outletId === activePartition?.outletId ? styles.chipTextSelected : styles.chipText}>
                    {catalogOutletLabel(partition.outletId, activePartition?.outletId ?? null)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {!loading && !outletId ? (
          <Text style={styles.alertText} accessibilityRole="alert">
            No authorized or cached Merchant outlet is available.
          </Text>
        ) : null}

        {/* Stock Conflict Banner */}
        {stockConflictMessage ? (
          <StockConflictBanner
            message={stockConflictMessage}
            onDismiss={() => setStockConflictMessage(null)}
          />
        ) : null}

        {/* Unknown Outcome Banner */}
        {unknownOutcomeKey ? (
          <UnknownOutcomeBanner
            idempotencyKey={unknownOutcomeKey}
            checking={checkingOutcome}
            onCheckStatus={() => void handleReconcileUnknownOutcome()}
            onDismiss={() => setUnknownOutcomeKey(null)}
          />
        ) : null}

        {/* Scanner Viewfinder Area */}
        <BarcodeScannerView
          permission={permission}
          onRequestPermission={requestCameraPermission}
          onManualEntryPress={() => setShowManualInput(!showManualInput)}
          rapidScanMode={rapidScanMode}
          onToggleRapidScan={() => setRapidScanMode(!rapidScanMode)}
          torchOn={torchOn}
          onToggleTorch={() => setTorchOn(!torchOn)}
          active={!resolving && !completedSale && !showConfirmModal}
          lastScannedCode={lastScannedCode}
        />

        {/* Manual Barcode Entry Fallback Drawer */}
        {showManualInput ? (
          <View style={styles.manualEntryBox}>
            <Text style={styles.sectionTitle}>Manual Barcode Lookup</Text>
            <View style={styles.rowWrap}>
              {BARCODE_TYPES.map((type) => (
                <Pressable
                  key={type}
                  accessibilityRole="button"
                  onPress={() => {
                    setBarcodeType(type);
                    resetResolution();
                  }}
                  style={[styles.chip, barcodeType === type ? styles.chipSelected : null]}
                >
                  <Text style={barcodeType === type ? styles.chipTextSelected : styles.chipText}>
                    {catalogSelectedLabel(barcodeType, type)}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.manualInputRow}>
              <TextInput
                value={barcodeInput}
                onChangeText={(val) => {
                  setBarcodeInput(val);
                  resetResolution();
                }}
                autoCapitalize={barcodeType === 'INTERNAL' ? 'characters' : 'none'}
                keyboardType={barcodeType === 'INTERNAL' ? 'default' : 'number-pad'}
                placeholder="Enter EAN/UPC/SKU code"
                accessibilityLabel="Barcode value"
                style={styles.input}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Lookup barcode"
                disabled={loading || resolving || !outletId || barcodeInput.trim().length === 0}
                onPress={() => void handleResolveBarcode(barcodeType, barcodeInput, 'MANUAL')}
                style={[
                  styles.lookupButton,
                  barcodeInput.trim().length === 0 ? styles.buttonDisabled : null,
                ]}
              >
                <Text style={styles.lookupButtonText}>
                  {resolving ? '…' : 'Lookup'}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {/* Status Notice Message */}
        {message ? (
          <Text accessibilityRole="alert" style={styles.notice}>
            {message}
          </Text>
        ) : null}

        {/* Resolved Product Card */}
        {resolvedListing ? (
          <ProductFoundCard
            listing={resolvedListing}
            availableStock={resolvedAvailableStock}
            quantityInCart={currentItemInCartQuantity}
            onAddToCart={handleAddToCart}
            onDismiss={() => setResolvedListing(null)}
          />
        ) : null}

        {/* Unknown Barcode Card */}
        {unknownBarcode ? (
          <UnknownBarcodeCard
            barcodeType={barcodeType}
            rawBarcode={unknownBarcode}
            canCreateDraft={canCreateOfflineDraft}
            onRetry={() => {
              setUnknownBarcode(null);
              resetResolution();
            }}
            onCreateDraft={() => {
              setScreenMode('ONBOARDING');
            }}
            onManualEntry={() => {
              setShowManualInput(true);
            }}
            onDismiss={() => setUnknownBarcode(null)}
          />
        ) : null}

        {/* POS Mode: Interactive POS Cart */}
        {screenMode === 'POS' ? (
          <PosCartView
            cart={cart}
            isOnline={isOnline}
            onUpdateQuantity={handleUpdateQuantity}
            onRemoveItem={handleRemoveItem}
            onClearCart={handleClearCart}
            onSetPayment={handleSetPayment}
            onSetCustomer={handleSetCustomer}
            onCheckoutPress={() => setShowConfirmModal(true)}
            submitting={submittingSale}
          />
        ) : null}

        {/* Onboarding Mode: Offline Catalog Draft Creator */}
        {screenMode === 'ONBOARDING' && unknownBarcode && canCreateOfflineDraft ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Create offline product draft</Text>
            <Text style={styles.body}>
              {barcodeType} · {unknownBarcode}
            </Text>
            <TextInput
              value={draftName}
              onChangeText={setDraftName}
              placeholder="Product name"
              style={styles.input}
            />
            <View style={styles.rowWrap}>
              {(['PRODUCT', 'MEDICINE'] as ListingKind[]).map((val) => (
                <Pressable
                  key={val}
                  accessibilityRole="button"
                  onPress={() => setKind(val)}
                  style={[styles.chip, kind === val ? styles.chipSelected : null]}
                >
                  <Text style={kind === val ? styles.chipTextSelected : styles.chipText}>
                    {catalogSelectedLabel(kind, val)}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.body}>
              Commerce mode: {draftCommerceMode}
              {kind === 'MEDICINE' ? ' (policy enforced)' : ''}
            </Text>
            <TextInput
              value={mrp}
              onChangeText={setMrp}
              placeholder="MRP ₹"
              keyboardType="decimal-pad"
              style={styles.input}
            />
            <TextInput
              value={sellingPrice}
              onChangeText={setSellingPrice}
              placeholder="Selling price ₹"
              keyboardType="decimal-pad"
              style={styles.input}
            />
            <TextInput
              value={category}
              onChangeText={setCategory}
              placeholder="Category slug"
              autoCapitalize="none"
              style={styles.input}
            />
            <Button title="Save local draft" onPress={() => void createDraft()} />
          </View>
        ) : null}

        {/* Existing Draft Status Card */}
        {screenMode === 'ONBOARDING' && draft ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{draft.name}</Text>
            <Text style={styles.body}>Status: {draft.status}</Text>
            <Text style={styles.body}>Local ID: {draft.localId}</Text>
            <Text style={styles.body}>
              Canonical ID: {draft.canonicalListingId ?? 'not assigned'}
            </Text>
            {draft.rejectionCode ? (
              <Text style={styles.errorText}>
                Server reason: {draft.rejectionCode} — {draft.rejectionDetails}
              </Text>
            ) : null}
            <Button title="Sync now" onPress={() => void syncNow()} />
          </View>
        ) : null}
      </ScrollView>

      {/* Sale Confirmation Modal */}
      <SaleConfirmationModal
        visible={showConfirmModal}
        cart={cart}
        outletLabel={activePartition?.outletId ? catalogOutletLabel(activePartition.outletId, null) : undefined}
        onConfirm={() => void handleConfirmSale()}
        onCancel={() => setShowConfirmModal(false)}
        submitting={submittingSale}
        error={message}
      />

      {/* Sale Receipt Modal */}
      <SaleReceiptModal
        visible={Boolean(completedSale)}
        sale={completedSale}
        cart={cart}
        outletLabel={activePartition?.outletId ? catalogOutletLabel(activePartition.outletId, null) : undefined}
        onNewSale={handleStartNewSale}
        onClose={() => setCompletedSale(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.md,
    gap: spacing.md,
  },
  header: {
    gap: spacing.sm,
  },
  title: {
    ...typography.headlineLg,
    color: colors.onSurface,
  },
  modeTabsRow: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceDim,
    borderRadius: radius.sm,
    padding: 3,
  },
  modeTab: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  modeTabActive: {
    backgroundColor: colors.surface,
    shadowColor: colors.slate900,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  modeTabText: {
    ...typography.labelMd,
    color: colors.onSurfaceVariant,
  },
  modeTabTextActive: {
    ...typography.labelMd,
    color: colors.primary,
    fontWeight: '700',
  },
  partitionContainer: {
    gap: spacing.xs,
  },
  subLabel: {
    ...typography.labelMd,
    color: colors.onSurfaceVariant,
  },
  rowWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
  },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    backgroundColor: colors.surface,
  },
  chipSelected: {
    backgroundColor: colors.primaryLight,
    borderColor: colors.primary,
  },
  chipText: {
    ...typography.bodyMd,
    fontSize: 12,
    color: colors.onSurface,
  },
  chipTextSelected: {
    ...typography.bodyMd,
    fontSize: 12,
    color: colors.primary,
    fontWeight: '700',
  },
  alertText: {
    ...typography.bodyMd,
    color: colors.error,
    fontWeight: '600',
  },
  manualEntryBox: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  sectionTitle: {
    ...typography.labelLg,
    color: colors.onSurface,
    fontWeight: '700',
  },
  manualInputRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  input: {
    flex: 1,
    minHeight: 46,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    fontSize: 14,
    backgroundColor: colors.surface,
  },
  lookupButton: {
    minHeight: 46,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lookupButtonText: {
    ...typography.labelMd,
    color: colors.onPrimary,
    fontWeight: '700',
  },
  buttonDisabled: {
    backgroundColor: colors.surfaceContainer,
  },
  notice: {
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceDim,
    ...typography.bodyMd,
    color: colors.onSurface,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  cardTitle: {
    ...typography.headlineMd,
    color: colors.onSurface,
  },
  body: {
    ...typography.bodyMd,
    color: colors.onSurfaceVariant,
  },
  errorText: {
    ...typography.bodyMd,
    color: colors.error,
  },
});
