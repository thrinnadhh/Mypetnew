-- M6: durable Merchant cursor change feed log.
-- Records every canonical mutation for catalog items, barcodes, and inventory balances
-- with a monotonic database-ordered sequence number, tenant scoping, entity versions,
-- and tombstone flags.

CREATE TABLE mypet.merchant_sync_change_log (
    sequence_number BIGSERIAL PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES mypet.merchant_organization(id),
    outlet_id UUID NOT NULL REFERENCES mypet.provider_outlet(id),
    entity_type VARCHAR(32) NOT NULL,
    entity_id UUID NOT NULL,
    entity_version BIGINT NOT NULL,
    is_tombstone BOOLEAN NOT NULL DEFAULT FALSE,
    payload TEXT NOT NULL,
    schema_version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (entity_version >= 0),
    CHECK (schema_version >= 1),
    CHECK (entity_type IN ('CATALOG_ITEM', 'CATALOG_BARCODE', 'INVENTORY_BALANCE'))
);

CREATE INDEX idx_merchant_sync_change_outlet_seq
    ON mypet.merchant_sync_change_log (organization_id, outlet_id, sequence_number);

CREATE INDEX idx_merchant_sync_change_entity
    ON mypet.merchant_sync_change_log (organization_id, outlet_id, entity_type, entity_id);

CREATE INDEX idx_merchant_sync_change_created_at
    ON mypet.merchant_sync_change_log (created_at);
