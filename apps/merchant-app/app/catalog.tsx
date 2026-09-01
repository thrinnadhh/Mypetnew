import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { loadOfflineMerchantAccountId } from '../src/auth/offline-account';
import {
  type CatalogMediaAsset,
  catalogMediaCommandKey,
  changeListingStatus,
  createListing,
  fetchCatalogPage,
  fetchMerchantCatalogContext,
  type CreateListingInput,
  type ListingStatus,
  type MerchantCatalogContext,
  type MerchantListing,
  type UpdateListingInput,
  updateListing,
  uploadCatalogMedia,
} from '../src/catalog/api';
import {
  applyCatalogMediaAttachment,
  canUploadCatalogMedia,
  canWriteCatalog,
  catalogErrorMessage,
  catalogMediaAssetFromPicker,
  catalogPageLabel,
  shouldReloadCatalogAfterError,
  type CatalogStatusFilter,
} from '../src/catalog/model';
import { useMerchantDatabase } from '../src/data';
import { createPartitionContext } from '../src/data/models/partition-context';
import {
  BottomNavigation,
  CatalogProductCard,
  ConfirmationModal,
  EmptyState,
  ErrorState,
  FilterBar,
  type FilterOption,
  LoadingState,
  MerchantHeader,
  MerchantScreen,
  PrimaryButton,
  ProductEditorModal,
  SearchInput,
  SecondaryButton,
  type SyncStateMode,
  colors,
  spacing,
  typography,
} from '../src/design';
import { summarizeOperationalSync, type OperationalSyncSummary } from '../src/operations/sync-summary';

type PendingMediaUpload = {
  listing: MerchantListing;
  asset: CatalogMediaAsset;
  idempotencyKey: string;
};

export default function MerchantCatalogScreen() {
  const { outboxRepo, syncStateRepo } = useMerchantDatabase();
  const [merchantContext, setMerchantContext] = useState<MerchantCatalogContext>();
  const [outletId, setOutletId] = useState<string>();
  const [permissions, setPermissions] = useState<Record<string, string[]>>({});
  const [items, setItems] = useState<MerchantListing[]>([]);
  const [page, setPage] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<CatalogStatusFilter>('ALL');
  const [sync, setSync] = useState<OperationalSyncSummary>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [pendingMedia, setPendingMedia] = useState<PendingMediaUpload | null>(null);
  const [message, setMessage] = useState('');

  // Modals state
  const [editorVisible, setEditorVisible] = useState(false);
  const [editingListing, setEditingListing] = useState<MerchantListing | null>(null);
  const [deactivateListing, setDeactivateListing] = useState<MerchantListing | null>(null);

  const canWrite = useMemo(() => canWriteCatalog(permissions, outletId ?? null), [outletId, permissions]);

  const load = useCallback(async (selectedOutlet?: string, targetPage = 0) => {
    setMessage('');
    try {
      if (!selectedOutlet) {
        setItems([]);
        return;
      }
      const apiStatus: ListingStatus | undefined =
        statusFilter === 'ACTIVE' || statusFilter === 'INACTIVE' ? statusFilter : undefined;
      const result = await fetchCatalogPage(selectedOutlet, {
        query: searchQuery.trim() || undefined,
        status: apiStatus,
        page: targetPage,
        pageSize: 25,
      });
      setItems(result.items);
      setPage(result.page);
      setHasNext(result.hasNext);

      if (outboxRepo && syncStateRepo && merchantContext?.organizationId) {
        try {
          const accountId = await loadOfflineMerchantAccountId();
          if (accountId) {
            const orgId = merchantContext.organizationId;
            const outletIds = [selectedOutlet];
            const partitions = outletIds.map((id) => createPartitionContext(accountId, orgId, id));
            setSync(await summarizeOperationalSync(partitions, syncStateRepo, outboxRepo));
          }
        } catch {
          // Local sync reading error
        }
      }
    } catch (error) {
      setItems([]);
      setMessage(catalogErrorMessage(error));
    }
  }, [merchantContext, outboxRepo, searchQuery, statusFilter, syncStateRepo]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load(outletId, page);
    setRefreshing(false);
  }, [load, outletId, page]);

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      try {
        const context = await fetchMerchantCatalogContext();
        if (!active) return;
        setMerchantContext(context);
        setPermissions(context.permissionsByOutlet);
        const initialOutlet = context.outletIds[0];
        if (initialOutlet) {
          setOutletId(initialOutlet);
          await load(initialOutlet, 0);
        }
      } catch (error) {
        if (active) setMessage(catalogErrorMessage(error));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [load]);

  const outletOptions = useMemo(() => {
    if (!merchantContext) return [];
    return merchantContext.outletIds.map((id, index) => ({
      id,
      name: `Outlet ${index + 1} (${id.slice(0, 8)})`,
    }));
  }, [merchantContext]);

  const currentOutletName = useMemo(() => {
    if (!outletId) return 'All Outlets';
    const found = outletOptions.find((o) => o.id === outletId);
    return found ? found.name : outletId;
  }, [outletId, outletOptions]);

  const syncMode: SyncStateMode = useMemo(() => {
    if (message && message.toLowerCase().includes('network')) return 'offline';
    if (!sync) return 'online';
    if (sync.commands.rejected > 0 || sync.commands.blocked > 0) return 'failed';
    if (sync.commands.sending > 0) return 'syncing';
    if (sync.commands.pending > 0 || sync.commands.retry > 0) return 'pending';
    return 'online';
  }, [message, sync]);

  const pendingCount = sync ? (sync.commands.pending + sync.commands.retry + sync.commands.reconciliation) : 0;

  function handleSelectOutlet(selected?: string) {
    if (!selected) return;
    setOutletId(selected);
    setPage(0);
    setLoading(true);
    void (async () => {
      await load(selected, 0);
      setLoading(false);
    })();
  }

  const filterOptions: FilterOption<CatalogStatusFilter>[] = [
    { id: 'ALL', label: 'All Listings' },
    { id: 'ACTIVE', label: 'Active' },
    { id: 'INACTIVE', label: 'Inactive' },
  ];

  async function handleSaveCreate(input: CreateListingInput) {
    if (!outletId) throw new Error('Outlet required.');
    setSaving(true);
    try {
      await createListing(outletId, input);
      setMessage(`Product "${input.name}" created successfully.`);
      await load(outletId, 0);
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveUpdate(listing: MerchantListing, input: UpdateListingInput) {
    setSaving(true);
    try {
      await updateListing(listing, input);
      setMessage(`Product "${input.name}" updated successfully.`);
      await load(outletId, page);
    } finally {
      setSaving(false);
    }
  }

  function handleToggleStatusRequest(listing: MerchantListing) {
    if (listing.status === 'ACTIVE') {
      // Deactivating requires confirmation
      setDeactivateListing(listing);
    } else {
      void performStatusToggle(listing, 'ACTIVE');
    }
  }

  async function performStatusToggle(listing: MerchantListing, targetStatus: ListingStatus) {
    if (!outletId) return;
    setSaving(true);
    setMessage('');
    try {
      await changeListingStatus(listing, targetStatus);
      setMessage(`Listing is now ${targetStatus.toLowerCase()}.`);
      await load(outletId, page);
    } catch (error) {
      setMessage(catalogErrorMessage(error));
      if (shouldReloadCatalogAfterError(error)) await load(outletId, page);
    } finally {
      setSaving(false);
      setDeactivateListing(null);
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
      await load(pending.listing.outletId, page);
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
      else setPendingMedia(pending);
      setMessage(catalogErrorMessage(error));
      if (name === 'CATALOG_VERSION_CONFLICT') {
        await load(pending.listing.outletId, page);
      }
    } finally {
      setUploadingMedia(false);
    }
  }

  async function handleAddImage(listing: MerchantListing) {
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
        quality: 0.9,
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

  const moreMenuItems = useMemo(() => [
    {
      key: 'barcode',
      label: 'Barcode Scanner',
      icon: '📷',
      subtitle: 'Scan & onboard products offline',
      onPress: () => router.push('/barcode'),
    },
    {
      key: 'appointments',
      label: 'Booking Requests',
      icon: '📅',
      subtitle: 'Grooming & vet appointments',
      onPress: () => router.push('/appointments'),
    },
    {
      key: 'notifications',
      label: 'Notifications',
      icon: '🔔',
      subtitle: 'Inbox & operational alerts',
      onPress: () => router.push('/notifications'),
    },
    {
      key: 'sync',
      label: 'Sync & Conflicts',
      icon: '🔄',
      subtitle: 'Device outbox and sync status',
      badge: pendingCount > 0 ? pendingCount : undefined,
      onPress: () => router.push('/sync-status'),
    },
  ], [pendingCount]);

  return (
    <View style={styles.container}>
      <MerchantHeader
        outletName={currentOutletName}
        businessName="MyPet Merchant"
        outlets={outletOptions}
        selectedOutletId={outletId}
        onSelectOutlet={handleSelectOutlet}
        syncMode={syncMode}
        pendingSyncCount={pendingCount}
        onSyncPress={() => router.push('/sync-status')}
        onNotificationsPress={() => router.push('/notifications')}
      />

      <MerchantScreen
        showHeader={false}
        scrollable
        refreshing={refreshing}
        onRefresh={() => void refresh()}
        offlineBannerProps={
          syncMode === 'offline' || pendingCount > 0 || syncMode === 'failed'
            ? {
                variant: syncMode === 'failed' ? 'failed' : pendingCount > 0 ? 'pending' : 'offline',
                pendingCount,
                onAction: () => router.push('/sync-status'),
                actionLabel: syncMode === 'failed' ? 'Resolve' : 'View Sync',
              }
            : undefined
        }
        showBottomNav={false}
        contentContainerStyle={styles.content}
      >
        {/* Controls Section */}
        <View style={styles.controls}>
          <SearchInput
            value={searchQuery}
            onChangeText={(q) => {
              setSearchQuery(q);
              setPage(0);
              if (outletId) void load(outletId, 0);
            }}
            placeholder="Search name, category, brand, SKU…"
            onBarcodeScan={() => router.push('/barcode')}
            accessibilityLabel="Search catalog"
            testID="catalog-search-input"
          />

          <FilterBar
            options={filterOptions}
            selectedId={statusFilter}
            onSelect={(status) => {
              setStatusFilter(status);
              setPage(0);
              if (outletId) void load(outletId, 0);
            }}
            testID="catalog-filter-bar"
          />

          {canWrite ? (
            <PrimaryButton
              title="+ Add New Product"
              onPress={() => {
                setEditingListing(null);
                setEditorVisible(true);
              }}
              testID="add-product-btn"
            />
          ) : null}
        </View>

        {/* Notice/Alert Banner */}
        {message ? (
          <View style={styles.noticeBanner}>
            <Text accessibilityRole="alert" style={styles.noticeText}>
              {message}
            </Text>
          </View>
        ) : null}

        {/* List Content */}
        {loading ? (
          <LoadingState message="Loading catalog listings…" testID="catalog-loading-view" />
        ) : items.length === 0 ? (
          <EmptyState
            title="No Products Found"
            description="No listings match your search or filter in this outlet."
            actionTitle={canWrite ? "Create Product" : "Clear Filter"}
            onAction={() => {
              if (canWrite) {
                setEditingListing(null);
                setEditorVisible(true);
              } else {
                setStatusFilter('ALL');
                setSearchQuery('');
              }
            }}
            testID="catalog-empty-state"
          />
        ) : (
          <View style={styles.productList}>
            {items.map((listing) => (
              <CatalogProductCard
                key={listing.id}
                listing={listing}
                canWrite={canWrite}
                saving={saving}
                uploadingMedia={uploadingMedia}
                isPendingMedia={pendingMedia?.listing.id === listing.id}
                onEdit={(item) => {
                  setEditingListing(item);
                  setEditorVisible(true);
                }}
                onToggleStatus={handleToggleStatusRequest}
                onAddImage={handleAddImage}
                onRetryUpload={pendingMedia ? () => void performMediaUpload(pendingMedia) : undefined}
                testID={`product-card-${listing.id}`}
              />
            ))}

            {/* Pagination Controls */}
            <View style={styles.paginationRow}>
              <SecondaryButton
                title="← Previous"
                onPress={() => {
                  if (page > 0 && outletId) {
                    const prev = page - 1;
                    setPage(prev);
                    void load(outletId, prev);
                  }
                }}
                disabled={page === 0 || loading || saving}
                style={styles.pageBtn}
              />
              <Text style={styles.pageText}>{catalogPageLabel(page)}</Text>
              <SecondaryButton
                title="Next →"
                onPress={() => {
                  if (hasNext && outletId) {
                    const next = page + 1;
                    setPage(next);
                    void load(outletId, next);
                  }
                }}
                disabled={!hasNext || loading || saving}
                style={styles.pageBtn}
              />
            </View>
          </View>
        )}
      </MerchantScreen>

      {/* Create / Edit Product Modal */}
      <ProductEditorModal
        visible={editorVisible}
        editingListing={editingListing}
        onClose={() => setEditorVisible(false)}
        onSaveCreate={handleSaveCreate}
        onSaveUpdate={handleSaveUpdate}
        onScanBarcode={() => {
          setEditorVisible(false);
          router.push('/barcode');
        }}
        loading={saving}
        testID="product-editor-modal"
      />

      {/* Deactivate Product Confirmation Modal */}
      <ConfirmationModal
        visible={Boolean(deactivateListing)}
        title="Deactivate Product"
        message={`Are you sure you want to deactivate "${deactivateListing?.name}"? Customers and POS will not be able to purchase inactive items.`}
        confirmLabel="Deactivate"
        variant="destructive"
        loading={saving}
        onConfirm={() => {
          if (deactivateListing) void performStatusToggle(deactivateListing, 'INACTIVE');
        }}
        onCancel={() => setDeactivateListing(null)}
        testID="deactivate-confirm-modal"
      />

      <BottomNavigation
        activeTab="catalog"
        onTabPress={(tab) => {
          if (tab === 'home') router.push('/dashboard');
          else if (tab === 'orders') router.push('/orders');
          else if (tab === 'inventory') router.push('/inventory');
          else if (tab === 'catalog') void refresh();
        }}
        moreMenuItems={moreMenuItems}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surfaceDim,
  },
  content: {
    padding: spacing.md,
    gap: spacing.md,
    paddingBottom: spacing.xxl,
  },
  controls: {
    gap: spacing.xs,
  },
  noticeBanner: {
    backgroundColor: colors.warningContainer,
    padding: spacing.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  noticeText: {
    ...typography.bodyMd,
    color: colors.onWarningContainer,
    fontWeight: '600',
  },
  productList: {
    gap: spacing.md,
  },
  paginationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
  },
  pageBtn: {
    minWidth: 110,
  },
  pageText: {
    ...typography.labelMd,
    color: colors.slate700,
  },
});
