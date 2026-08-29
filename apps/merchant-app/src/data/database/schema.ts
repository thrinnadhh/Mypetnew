export const CURRENT_SCHEMA_VERSION = 5;

export const TABLE_PROJECTION_SYNC_STATE = 'projection_sync_state';
export const TABLE_CATALOG_ITEMS = 'catalog_items';
export const TABLE_CATALOG_BARCODES = 'catalog_barcodes';
export const TABLE_INVENTORY_BALANCES = 'inventory_balances';
export const TABLE_PROJECTION_TOMBSTONES = 'projection_tombstones';
export const TABLE_OFFLINE_COMMANDS = 'offline_commands';
export const TABLE_OFFLINE_COMMAND_DEPENDENCIES = 'offline_command_dependencies';
export const TABLE_BOOTSTRAP_STAGING_ITEMS = 'bootstrap_staging_items';
export const TABLE_BOOTSTRAP_STAGING_BALANCES = 'bootstrap_staging_balances';
export const TABLE_BOOTSTRAP_STAGING_BARCODES = 'bootstrap_staging_barcodes';
export const TABLE_BOOTSTRAP_STAGING_STATE = 'bootstrap_staging_state';
export const TABLE_LOCAL_CATALOG_DRAFTS = 'local_catalog_drafts';
export const TABLE_CATALOG_IDENTITY_MAPPINGS = 'catalog_identity_mappings';
export const TABLE_CATALOG_MEDIA_JOBS = 'catalog_media_jobs';

export const V1_SCHEMA_STATEMENTS = [
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

export const V3_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS ${TABLE_OFFLINE_COMMANDS} (
    account_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    outlet_id TEXT NOT NULL,
    command_id TEXT NOT NULL,
    installation_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    command_type TEXT NOT NULL,
    payload_schema_version INTEGER NOT NULL,
    payload_json TEXT NOT NULL,
    request_fingerprint TEXT NOT NULL,
    state TEXT NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_attempt_at TEXT NULL,
    next_attempt_at TEXT NULL,
    lease_owner TEXT NULL,
    lease_expires_at TEXT NULL,
    last_error_code TEXT NULL,
    last_error_details TEXT NULL,
    durable_server_receipt TEXT NULL,
    resulting_version INTEGER NULL,
    PRIMARY KEY (account_id, organization_id, outlet_id, command_id),
    UNIQUE (account_id, organization_id, outlet_id, idempotency_key)
  );`,
  `CREATE TABLE IF NOT EXISTS ${TABLE_OFFLINE_COMMAND_DEPENDENCIES} (
    account_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    outlet_id TEXT NOT NULL,
    command_id TEXT NOT NULL,
    depends_on_command_id TEXT NOT NULL,
    PRIMARY KEY (account_id, organization_id, outlet_id, command_id, depends_on_command_id)
  );`,
  `CREATE INDEX IF NOT EXISTS idx_offline_commands_partition_state
    ON ${TABLE_OFFLINE_COMMANDS} (account_id, organization_id, outlet_id, state, next_attempt_at);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_offline_commands_idempotency
    ON ${TABLE_OFFLINE_COMMANDS} (account_id, organization_id, outlet_id, idempotency_key);`,
  `CREATE INDEX IF NOT EXISTS idx_offline_command_dependencies_parent
    ON ${TABLE_OFFLINE_COMMAND_DEPENDENCIES} (account_id, organization_id, outlet_id, depends_on_command_id);`,
];

export const V4_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS ${TABLE_BOOTSTRAP_STAGING_ITEMS} (
    generation_id TEXT NOT NULL,
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
    image_urls_json TEXT NOT NULL,
    status TEXT NOT NULL,
    version INTEGER NOT NULL,
    server_created_at TEXT NOT NULL,
    server_updated_at TEXT NOT NULL,
    PRIMARY KEY (generation_id, account_id, organization_id, outlet_id, id)
  );`,
  `CREATE TABLE IF NOT EXISTS ${TABLE_BOOTSTRAP_STAGING_BALANCES} (
    generation_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    outlet_id TEXT NOT NULL,
    listing_id TEXT NOT NULL,
    on_hand INTEGER NOT NULL,
    reserved INTEGER NOT NULL,
    version INTEGER NOT NULL,
    server_updated_at TEXT NOT NULL,
    PRIMARY KEY (generation_id, account_id, organization_id, outlet_id, listing_id)
  );`,
  `CREATE TABLE IF NOT EXISTS ${TABLE_BOOTSTRAP_STAGING_BARCODES} (
    generation_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    outlet_id TEXT NOT NULL,
    listing_id TEXT NOT NULL,
    barcode_type TEXT NOT NULL,
    normalized_barcode TEXT NOT NULL,
    is_primary INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (generation_id, account_id, organization_id, outlet_id, normalized_barcode)
  );`,
  `CREATE TABLE IF NOT EXISTS ${TABLE_BOOTSTRAP_STAGING_STATE} (
    generation_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    outlet_id TEXT NOT NULL,
    high_water_cursor TEXT NOT NULL,
    next_page_cursor TEXT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (account_id, organization_id, outlet_id)
  );`,
];

export const V5_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS ${TABLE_LOCAL_CATALOG_DRAFTS} (
    account_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    outlet_id TEXT NOT NULL,
    temp_listing_id TEXT NOT NULL,
    create_command_id TEXT NULL,
    canonical_listing_id TEXT NULL,
    barcode_type TEXT NOT NULL,
    barcode TEXT NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    mrp_paise INTEGER NOT NULL,
    selling_price_paise INTEGER NOT NULL,
    category TEXT NOT NULL,
    brand TEXT NULL,
    description TEXT NULL,
    pet_type TEXT NULL,
    life_stage TEXT NULL,
    pack_label TEXT NULL,
    sku TEXT NULL,
    state TEXT NOT NULL,
    conflict_json TEXT NULL,
    last_error_code TEXT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (account_id, organization_id, outlet_id, temp_listing_id)
  );`,
  `CREATE TABLE IF NOT EXISTS ${TABLE_CATALOG_IDENTITY_MAPPINGS} (
    account_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    outlet_id TEXT NOT NULL,
    temp_listing_id TEXT NOT NULL,
    canonical_listing_id TEXT NOT NULL,
    outcome TEXT NOT NULL,
    mapped_at TEXT NOT NULL,
    PRIMARY KEY (account_id, organization_id, outlet_id, temp_listing_id)
  );`,
  `CREATE TABLE IF NOT EXISTS ${TABLE_CATALOG_MEDIA_JOBS} (
    account_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    outlet_id TEXT NOT NULL,
    media_job_id TEXT NOT NULL,
    temp_listing_id TEXT NOT NULL,
    canonical_listing_id TEXT NULL,
    filename TEXT NOT NULL,
    content_type TEXT NOT NULL,
    bytes_base64 TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    idempotency_key TEXT NOT NULL,
    state TEXT NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    lease_expires_at TEXT NULL,
    last_error_code TEXT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (account_id, organization_id, outlet_id, media_job_id),
    UNIQUE (account_id, organization_id, outlet_id, idempotency_key)
  );`,
  `CREATE INDEX IF NOT EXISTS idx_local_catalog_drafts_state
    ON ${TABLE_LOCAL_CATALOG_DRAFTS} (account_id, organization_id, outlet_id, state, updated_at);`,
  `CREATE INDEX IF NOT EXISTS idx_catalog_identity_canonical
    ON ${TABLE_CATALOG_IDENTITY_MAPPINGS} (account_id, organization_id, outlet_id, canonical_listing_id);`,
  `CREATE INDEX IF NOT EXISTS idx_catalog_media_jobs_state
    ON ${TABLE_CATALOG_MEDIA_JOBS} (account_id, organization_id, outlet_id, state, updated_at);`,
];

export const ALL_SCHEMA_STATEMENTS = [
  ...V1_SCHEMA_STATEMENTS,
  ...V2_SCHEMA_STATEMENTS,
  ...V3_SCHEMA_STATEMENTS,
  ...V4_SCHEMA_STATEMENTS,
  ...V5_SCHEMA_STATEMENTS,
];
