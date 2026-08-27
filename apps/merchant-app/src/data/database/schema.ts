export const CURRENT_SCHEMA_VERSION = 2;

export const TABLE_PROJECTION_SYNC_STATE = 'projection_sync_state';
export const TABLE_CATALOG_ITEMS = 'catalog_items';
export const TABLE_CATALOG_BARCODES = 'catalog_barcodes';
export const TABLE_INVENTORY_BALANCES = 'inventory_balances';
export const TABLE_PROJECTION_TOMBSTONES = 'projection_tombstones';

export const V1_SCHEMA_STATEMENTS = [
  // 1. Sync metadata
  `CREATE TABLE IF NOT EXISTS ${TABLE_PROJECTION_SYNC_STATE} (
    account_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    outlet_id TEXT NOT NULL,
    projection_name TEXT NOT NULL,
    last_sync_at TEXT NULL,
    last_attempt_at TEXT NULL,
    status TEXT NOT NULL,
    cursor TEXT NULL,
    last_error TEXT NULL,
    PRIMARY KEY (account_id, organization_id, outlet_id, projection_name)
  );`,

  // 2. Catalog items projection
  `CREATE TABLE IF NOT EXISTS ${TABLE_CATALOG_ITEMS} (
    account_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    outlet_id TEXT NOT NULL,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    commerce_mode TEXT NOT NULL,
    barcode_type TEXT NOT NULL,
    normalized_barcode TEXT NOT NULL,
    mrp_paise INTEGER NOT NULL,
    selling_price_paise INTEGER NOT NULL,
    category TEXT NOT NULL,
    brand TEXT NULL,
    description TEXT NULL,
    pet_type TEXT NULL,
    life_stage TEXT NULL,
    pack_label TEXT NULL,
    sku TEXT NULL,
    image_urls_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL,
    version INTEGER NOT NULL,
    is_tombstone INTEGER NOT NULL DEFAULT 0,
    tombstoned_at TEXT NULL,
    server_created_at TEXT NOT NULL,
    server_updated_at TEXT NOT NULL,
    local_updated_at TEXT NOT NULL,
    PRIMARY KEY (account_id, organization_id, outlet_id, id)
  );`,

  // 3. Catalog barcode secondary / lookup index table
  `CREATE TABLE IF NOT EXISTS ${TABLE_CATALOG_BARCODES} (
    account_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    outlet_id TEXT NOT NULL,
    listing_id TEXT NOT NULL,
    barcode_type TEXT NOT NULL,
    normalized_barcode TEXT NOT NULL,
    is_primary INTEGER NOT NULL DEFAULT 1,
    is_tombstone INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (account_id, organization_id, outlet_id, listing_id, barcode_type, normalized_barcode)
  );`,

  // 4. Inventory balance projection
  `CREATE TABLE IF NOT EXISTS ${TABLE_INVENTORY_BALANCES} (
    account_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    outlet_id TEXT NOT NULL,
    listing_id TEXT NOT NULL,
    on_hand INTEGER NOT NULL,
    reserved INTEGER NOT NULL,
    available INTEGER NOT NULL,
    version INTEGER NOT NULL,
    server_updated_at TEXT NOT NULL,
    local_updated_at TEXT NOT NULL,
    is_tombstone INTEGER NOT NULL DEFAULT 0,
    tombstoned_at TEXT NULL,
    PRIMARY KEY (account_id, organization_id, outlet_id, listing_id)
  );`,

  // Indexes
  `CREATE INDEX IF NOT EXISTS idx_catalog_items_partition_status
    ON ${TABLE_CATALOG_ITEMS} (account_id, organization_id, outlet_id, status, is_tombstone);`,

  `CREATE INDEX IF NOT EXISTS idx_catalog_items_barcode
    ON ${TABLE_CATALOG_ITEMS} (account_id, organization_id, outlet_id, barcode_type, normalized_barcode, is_tombstone);`,

  `CREATE INDEX IF NOT EXISTS idx_catalog_barcodes_lookup
    ON ${TABLE_CATALOG_BARCODES} (account_id, organization_id, outlet_id, barcode_type, normalized_barcode, is_tombstone);`,

  `CREATE INDEX IF NOT EXISTS idx_inventory_balances_partition
    ON ${TABLE_INVENTORY_BALANCES} (account_id, organization_id, outlet_id, is_tombstone);`,

  `CREATE INDEX IF NOT EXISTS idx_sync_state_partition
    ON ${TABLE_PROJECTION_SYNC_STATE} (account_id, organization_id, outlet_id);`,
];

export const V2_SCHEMA_STATEMENTS = [
  // 5. Partitioned durable tombstone ledger
  `CREATE TABLE IF NOT EXISTS ${TABLE_PROJECTION_TOMBSTONES} (
    account_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    outlet_id TEXT NOT NULL,
    projection_name TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    server_updated_at TEXT NOT NULL,
    server_version INTEGER NULL,
    deleted_at TEXT NOT NULL,
    PRIMARY KEY (account_id, organization_id, outlet_id, projection_name, entity_id)
  );`,

  `CREATE INDEX IF NOT EXISTS idx_projection_tombstones_lookup
    ON ${TABLE_PROJECTION_TOMBSTONES} (account_id, organization_id, outlet_id, projection_name, entity_id);`,
];

export const ALL_SCHEMA_STATEMENTS = [
  ...V1_SCHEMA_STATEMENTS,
  ...V2_SCHEMA_STATEMENTS,
];
