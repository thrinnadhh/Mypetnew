-- M3: canonical immutable inventory ledger, tenant-scoped balance projection,
-- durable command receipts, atomic change publication, and legacy opening balances.

ALTER TABLE mypet.inventory_balance
    ADD COLUMN organization_id UUID,
    ADD COLUMN outlet_id UUID;

UPDATE mypet.inventory_balance b
SET organization_id = l.organization_id,
    outlet_id = l.outlet_id
FROM mypet.catalog_listing l
WHERE l.id = b.listing_id;

INSERT INTO mypet.inventory_balance (
    listing_id, on_hand, reserved, version, updated_at, organization_id, outlet_id
)
SELECT l.id, 0, 0, 0, CURRENT_TIMESTAMP, l.organization_id, l.outlet_id
FROM mypet.catalog_listing l
WHERE NOT EXISTS (
    SELECT 1 FROM mypet.inventory_balance b WHERE b.listing_id = l.id
);

ALTER TABLE mypet.inventory_balance
    ALTER COLUMN organization_id SET NOT NULL,
    ALTER COLUMN outlet_id SET NOT NULL;

ALTER TABLE mypet.inventory_movement
    ADD COLUMN organization_id UUID;

UPDATE mypet.inventory_movement m
SET organization_id = l.organization_id
FROM mypet.catalog_listing l
WHERE l.id = m.listing_id;

ALTER TABLE mypet.inventory_movement
    ALTER COLUMN organization_id SET NOT NULL;

CREATE UNIQUE INDEX uq_catalog_listing_inventory_scope
    ON mypet.catalog_listing (organization_id, outlet_id, id);

ALTER TABLE mypet.inventory_balance
    ADD CONSTRAINT fk_inventory_balance_listing_scope
        FOREIGN KEY (organization_id, outlet_id, listing_id)
        REFERENCES mypet.catalog_listing (organization_id, outlet_id, id);

ALTER TABLE mypet.inventory_movement
    ADD CONSTRAINT fk_inventory_movement_listing_scope
        FOREIGN KEY (organization_id, outlet_id, listing_id)
        REFERENCES mypet.catalog_listing (organization_id, outlet_id, id);

CREATE UNIQUE INDEX uq_inventory_balance_scope
    ON mypet.inventory_balance (organization_id, outlet_id, listing_id);

CREATE INDEX idx_inventory_movement_tenant_history
    ON mypet.inventory_movement (organization_id, outlet_id, listing_id, occurred_at DESC, id DESC);

CREATE INDEX idx_inventory_movement_reference
    ON mypet.inventory_movement (organization_id, outlet_id, source_type, source_reference);

-- Preserve the exact pre-M3 stock projection. If historical movements do not sum to the
-- current on-hand quantity, append one deterministic system-owned opening movement for the gap.
WITH ledger AS (
    SELECT listing_id, COALESCE(SUM(quantity_delta), 0)::BIGINT AS quantity
    FROM mypet.inventory_movement
    GROUP BY listing_id
), opening AS (
    SELECT
        b.organization_id,
        b.outlet_id,
        b.listing_id,
        b.on_hand,
        b.reserved,
        (b.on_hand::BIGINT - COALESCE(l.quantity, 0)) AS quantity_delta,
        md5('m3-opening-balance:' || b.listing_id::TEXT) AS digest
    FROM mypet.inventory_balance b
    LEFT JOIN ledger l ON l.listing_id = b.listing_id
)
INSERT INTO mypet.inventory_movement (
    id,
    organization_id,
    listing_id,
    outlet_id,
    reason,
    quantity_delta,
    resulting_on_hand,
    resulting_reserved,
    source_type,
    source_reference,
    actor_id,
    idempotency_key,
    trace_id,
    operation_scope,
    request_fingerprint,
    occurred_at
)
SELECT
    (
        substr(digest, 1, 8) || '-' || substr(digest, 9, 4) || '-' ||
        substr(digest, 13, 4) || '-' || substr(digest, 17, 4) || '-' ||
        substr(digest, 21, 12)
    )::UUID,
    organization_id,
    listing_id,
    outlet_id,
    'OPENING_BALANCE',
    quantity_delta::INTEGER,
    on_hand,
    reserved,
    'MIGRATION',
    'V24_LEGACY_STOCK_OPENING_BALANCE',
    '00000000-0000-0000-0000-000000000000'::UUID,
    'm3-opening:' || listing_id::TEXT,
    'migration-v24',
    'inventory-opening-balance',
    md5('m3-opening:' || listing_id::TEXT || ':' || quantity_delta::TEXT),
    CURRENT_TIMESTAMP
FROM opening
WHERE quantity_delta <> 0;

CREATE TABLE mypet.inventory_command_receipt (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES mypet.merchant_organization(id),
    outlet_id UUID NOT NULL REFERENCES mypet.provider_outlet(id),
    listing_id UUID NOT NULL REFERENCES mypet.catalog_listing(id),
    idempotency_key VARCHAR(128) NOT NULL,
    operation_scope VARCHAR(40) NOT NULL,
    request_fingerprint VARCHAR(64) NOT NULL,
    movement_id UUID NOT NULL UNIQUE REFERENCES mypet.inventory_movement(id),
    resulting_on_hand INTEGER NOT NULL,
    resulting_reserved INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_inventory_receipt_key UNIQUE (outlet_id, idempotency_key),
    CHECK (resulting_on_hand >= 0),
    CHECK (resulting_reserved >= 0),
    CHECK (resulting_on_hand >= resulting_reserved)
);

CREATE INDEX idx_inventory_receipt_tenant_key
    ON mypet.inventory_command_receipt (organization_id, outlet_id, idempotency_key);

-- One durable publication record per accepted inventory movement. The application inserts the
-- event in the same PostgreSQL transaction as movement, balance, and receipt.
CREATE UNIQUE INDEX uq_inventory_movement_change_publication
    ON mypet.outbox_event (aggregate_type, aggregate_id, event_type)
    WHERE aggregate_type = 'INVENTORY_MOVEMENT'
      AND event_type = 'INVENTORY_BALANCE_CHANGED';

CREATE OR REPLACE FUNCTION mypet.reject_inventory_movement_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'inventory_movement is append-only';
END;
$$;

CREATE TRIGGER inventory_movement_immutable
BEFORE UPDATE OR DELETE ON mypet.inventory_movement
FOR EACH ROW
EXECUTE FUNCTION mypet.reject_inventory_movement_mutation();
