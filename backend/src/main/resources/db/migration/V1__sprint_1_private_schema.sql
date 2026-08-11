CREATE SCHEMA IF NOT EXISTS mypet;

CREATE TABLE mypet.identity_account (
    id UUID PRIMARY KEY,
    mobile_e164 VARCHAR(16) NOT NULL UNIQUE,
    role VARCHAR(32) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (CASE role
        WHEN 'CUSTOMER' THEN TRUE
        WHEN 'MERCHANT' THEN TRUE
        WHEN 'CAPTAIN' THEN TRUE
        WHEN 'ADMIN' THEN TRUE
        ELSE FALSE
    END)
);

CREATE TABLE mypet.otp_challenge (
    id UUID PRIMARY KEY,
    mobile_hash VARCHAR(128) NOT NULL,
    purpose VARCHAR(48) NOT NULL,
    code_hash VARCHAR(128) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    consumed_at TIMESTAMP WITH TIME ZONE,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (attempt_count >= 0)
);

CREATE TABLE mypet.user_session (
    id UUID PRIMARY KEY,
    account_id UUID NOT NULL REFERENCES mypet.identity_account(id),
    refresh_token_hash VARCHAR(128) NOT NULL UNIQUE,
    device_id VARCHAR(128) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    revoked_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE mypet.merchant_organization (
    id UUID PRIMARY KEY,
    name VARCHAR(160) NOT NULL,
    status VARCHAR(32) NOT NULL,
    minimum_loyalty_spend_paise BIGINT NOT NULL DEFAULT 10000,
    reward_amount_paise BIGINT NOT NULL DEFAULT 5000,
    loyalty_rule_version VARCHAR(48) NOT NULL DEFAULT 's1-v1',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (minimum_loyalty_spend_paise >= 0),
    CHECK (reward_amount_paise >= 0)
);

CREATE TABLE mypet.provider_outlet (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES mypet.merchant_organization(id),
    name VARCHAR(160) NOT NULL,
    status VARCHAR(32) NOT NULL,
    pickup_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE mypet.outlet_capability (
    outlet_id UUID NOT NULL REFERENCES mypet.provider_outlet(id),
    capability VARCHAR(64) NOT NULL,
    verified BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (outlet_id, capability)
);

CREATE TABLE mypet.outlet_service_pincode (
    outlet_id UUID NOT NULL REFERENCES mypet.provider_outlet(id),
    pincode VARCHAR(6) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (outlet_id, pincode),
    CHECK (LENGTH(pincode) = 6)
);

CREATE TABLE mypet.merchant_staff (
    account_id UUID NOT NULL REFERENCES mypet.identity_account(id),
    organization_id UUID NOT NULL REFERENCES mypet.merchant_organization(id),
    outlet_id UUID NOT NULL REFERENCES mypet.provider_outlet(id),
    permission VARCHAR(64) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (account_id, outlet_id, permission)
);

CREATE TABLE mypet.catalog_listing (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES mypet.merchant_organization(id),
    outlet_id UUID NOT NULL REFERENCES mypet.provider_outlet(id),
    barcode_type VARCHAR(24) NOT NULL,
    normalized_barcode VARCHAR(64) NOT NULL,
    raw_barcode_audit VARCHAR(128),
    name VARCHAR(160) NOT NULL,
    listing_kind VARCHAR(24) NOT NULL,
    commerce_mode VARCHAR(24) NOT NULL,
    mrp_paise BIGINT NOT NULL,
    selling_price_paise BIGINT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_listing_outlet_barcode UNIQUE (organization_id, outlet_id, barcode_type, normalized_barcode),
    CHECK (mrp_paise >= 0),
    CHECK (selling_price_paise >= 0),
    CHECK (selling_price_paise <= mrp_paise),
    CHECK (CASE commerce_mode WHEN 'COMMERCE' THEN TRUE WHEN 'VIEW_ONLY' THEN TRUE ELSE FALSE END)
);

CREATE TABLE mypet.inventory_balance (
    listing_id UUID PRIMARY KEY REFERENCES mypet.catalog_listing(id),
    on_hand INTEGER NOT NULL DEFAULT 0,
    reserved INTEGER NOT NULL DEFAULT 0,
    version BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (on_hand >= 0),
    CHECK (reserved >= 0),
    CHECK (on_hand >= reserved)
);

CREATE TABLE mypet.inventory_movement (
    id UUID PRIMARY KEY,
    listing_id UUID NOT NULL REFERENCES mypet.catalog_listing(id),
    outlet_id UUID NOT NULL REFERENCES mypet.provider_outlet(id),
    reason VARCHAR(40) NOT NULL,
    quantity_delta INTEGER NOT NULL,
    resulting_on_hand INTEGER NOT NULL,
    resulting_reserved INTEGER NOT NULL,
    source_type VARCHAR(40) NOT NULL,
    source_reference VARCHAR(160) NOT NULL,
    actor_id UUID NOT NULL,
    idempotency_key VARCHAR(128) NOT NULL,
    trace_id VARCHAR(64) NOT NULL,
    occurred_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_inventory_movement_idempotency UNIQUE (outlet_id, idempotency_key),
    CHECK (resulting_on_hand >= resulting_reserved),
    CHECK (resulting_reserved >= 0)
);

CREATE TABLE mypet.customer_cart (
    id UUID PRIMARY KEY,
    owner_id UUID NOT NULL,
    outlet_id UUID NOT NULL REFERENCES mypet.provider_outlet(id),
    version BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_customer_cart_owner UNIQUE (owner_id)
);

CREATE TABLE mypet.cart_line (
    cart_id UUID NOT NULL REFERENCES mypet.customer_cart(id),
    listing_id UUID NOT NULL REFERENCES mypet.catalog_listing(id),
    quantity INTEGER NOT NULL,
    PRIMARY KEY (cart_id, listing_id),
    CHECK (quantity > 0)
);

CREATE TABLE mypet.commerce_quote (
    id UUID PRIMARY KEY,
    customer_id UUID NOT NULL REFERENCES mypet.identity_account(id),
    outlet_id UUID NOT NULL REFERENCES mypet.provider_outlet(id),
    cart_signature VARCHAR(128) NOT NULL,
    fulfilment_mode VARCHAR(32) NOT NULL,
    payment_method VARCHAR(40) NOT NULL,
    item_subtotal_paise BIGINT NOT NULL,
    platform_fee_paise BIGINT NOT NULL,
    merchant_commission_paise BIGINT NOT NULL,
    delivery_fee_paise BIGINT NOT NULL DEFAULT 0,
    grand_total_paise BIGINT NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    rule_version VARCHAR(48) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (item_subtotal_paise >= 0),
    CHECK (platform_fee_paise >= 0),
    CHECK (merchant_commission_paise >= 0),
    CHECK (grand_total_paise >= 0)
);

CREATE TABLE mypet.quote_line (
    quote_id UUID NOT NULL REFERENCES mypet.commerce_quote(id),
    listing_id UUID NOT NULL REFERENCES mypet.catalog_listing(id),
    quantity INTEGER NOT NULL,
    unit_price_paise BIGINT NOT NULL,
    PRIMARY KEY (quote_id, listing_id),
    CHECK (quantity > 0),
    CHECK (unit_price_paise >= 0)
);

CREATE TABLE mypet.product_order (
    id UUID PRIMARY KEY,
    order_number VARCHAR(32) NOT NULL UNIQUE,
    customer_id UUID NOT NULL REFERENCES mypet.identity_account(id),
    organization_id UUID NOT NULL REFERENCES mypet.merchant_organization(id),
    outlet_id UUID NOT NULL REFERENCES mypet.provider_outlet(id),
    quote_id UUID NOT NULL REFERENCES mypet.commerce_quote(id),
    status VARCHAR(32) NOT NULL,
    fulfilment_mode VARCHAR(32) NOT NULL,
    payment_method VARCHAR(40) NOT NULL,
    payment_status VARCHAR(40) NOT NULL,
    grand_total_paise BIGINT NOT NULL,
    platform_fee_paise BIGINT NOT NULL,
    merchant_commission_paise BIGINT NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (grand_total_paise >= 0)
);

CREATE TABLE mypet.product_order_line (
    order_id UUID NOT NULL REFERENCES mypet.product_order(id),
    listing_id UUID NOT NULL REFERENCES mypet.catalog_listing(id),
    listing_name VARCHAR(160) NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price_paise BIGINT NOT NULL,
    PRIMARY KEY (order_id, listing_id),
    CHECK (quantity > 0),
    CHECK (unit_price_paise >= 0)
);

CREATE TABLE mypet.product_order_history (
    id UUID PRIMARY KEY,
    order_id UUID NOT NULL REFERENCES mypet.product_order(id),
    from_status VARCHAR(32),
    to_status VARCHAR(32) NOT NULL,
    actor_id UUID NOT NULL,
    actor_role VARCHAR(32) NOT NULL,
    reason VARCHAR(240),
    idempotency_key VARCHAR(128) NOT NULL,
    trace_id VARCHAR(64) NOT NULL,
    occurred_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_order_history_command UNIQUE (order_id, idempotency_key)
);

CREATE TABLE mypet.inventory_reservation (
    id UUID PRIMARY KEY,
    order_id UUID NOT NULL REFERENCES mypet.product_order(id),
    listing_id UUID NOT NULL REFERENCES mypet.catalog_listing(id),
    quantity INTEGER NOT NULL,
    status VARCHAR(24) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_order_listing_reservation UNIQUE (order_id, listing_id),
    CHECK (quantity > 0)
);

CREATE TABLE mypet.pos_sale (
    id UUID PRIMARY KEY,
    sale_number VARCHAR(32) NOT NULL UNIQUE,
    organization_id UUID NOT NULL REFERENCES mypet.merchant_organization(id),
    outlet_id UUID NOT NULL REFERENCES mypet.provider_outlet(id),
    customer_id UUID REFERENCES mypet.identity_account(id),
    cashier_id UUID NOT NULL,
    total_paise BIGINT NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    payment_declaration VARCHAR(32) NOT NULL,
    idempotency_key VARCHAR(128) NOT NULL,
    completed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_pos_outlet_idempotency UNIQUE (outlet_id, idempotency_key),
    CHECK (total_paise >= 0)
);

CREATE TABLE mypet.pos_sale_line (
    sale_id UUID NOT NULL REFERENCES mypet.pos_sale(id),
    listing_id UUID NOT NULL REFERENCES mypet.catalog_listing(id),
    listing_name VARCHAR(160) NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price_paise BIGINT NOT NULL,
    PRIMARY KEY (sale_id, listing_id),
    CHECK (quantity > 0),
    CHECK (unit_price_paise >= 0)
);

CREATE TABLE mypet.loyalty_relationship (
    customer_id UUID NOT NULL REFERENCES mypet.identity_account(id),
    organization_id UUID NOT NULL REFERENCES mypet.merchant_organization(id),
    available_stars INTEGER NOT NULL DEFAULT 0,
    star_debt INTEGER NOT NULL DEFAULT 0,
    version BIGINT NOT NULL DEFAULT 0,
    PRIMARY KEY (customer_id, organization_id),
    CHECK (available_stars >= 0),
    CHECK (star_debt >= 0)
);

CREATE TABLE mypet.loyalty_source (
    id UUID PRIMARY KEY,
    customer_id UUID NOT NULL REFERENCES mypet.identity_account(id),
    organization_id UUID NOT NULL REFERENCES mypet.merchant_organization(id),
    outlet_id UUID REFERENCES mypet.provider_outlet(id),
    source_type VARCHAR(40) NOT NULL,
    source_reference VARCHAR(160) NOT NULL,
    eligible_spend_paise BIGINT NOT NULL,
    rule_version VARCHAR(48) NOT NULL,
    awarded BOOLEAN NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_loyalty_source UNIQUE (customer_id, organization_id, source_type, source_reference),
    CHECK (eligible_spend_paise >= 0)
);

CREATE TABLE mypet.loyalty_ledger (
    id UUID PRIMARY KEY,
    customer_id UUID NOT NULL REFERENCES mypet.identity_account(id),
    organization_id UUID NOT NULL REFERENCES mypet.merchant_organization(id),
    source_id UUID REFERENCES mypet.loyalty_source(id),
    entry_type VARCHAR(32) NOT NULL,
    star_delta INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE mypet.loyalty_reward (
    id UUID PRIMARY KEY,
    customer_id UUID NOT NULL REFERENCES mypet.identity_account(id),
    organization_id UUID NOT NULL REFERENCES mypet.merchant_organization(id),
    amount_paise BIGINT NOT NULL,
    status VARCHAR(24) NOT NULL,
    rule_version VARCHAR(48) NOT NULL,
    issued_at TIMESTAMP WITH TIME ZONE NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CHECK (amount_paise >= 0),
    CHECK (expires_at > issued_at)
);

CREATE TABLE mypet.idempotency_record (
    scope VARCHAR(120) NOT NULL,
    idempotency_key VARCHAR(128) NOT NULL,
    request_fingerprint VARCHAR(128) NOT NULL,
    response_status INTEGER NOT NULL,
    response_body TEXT NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (scope, idempotency_key)
);

CREATE TABLE mypet.outbox_event (
    id UUID PRIMARY KEY,
    aggregate_type VARCHAR(48) NOT NULL,
    aggregate_id UUID NOT NULL,
    event_type VARCHAR(80) NOT NULL,
    event_version INTEGER NOT NULL,
    payload TEXT NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'PENDING',
    attempt_count INTEGER NOT NULL DEFAULT 0,
    available_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    claimed_at TIMESTAMP WITH TIME ZONE,
    delivered_at TIMESTAMP WITH TIME ZONE,
    trace_id VARCHAR(64) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (attempt_count >= 0)
);

CREATE TABLE mypet.inbox_event (
    consumer_name VARCHAR(80) NOT NULL,
    source_event_id UUID NOT NULL,
    processed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (consumer_name, source_event_id)
);

CREATE TABLE mypet.device_registration (
    id UUID PRIMARY KEY,
    environment VARCHAR(24) NOT NULL,
    app_kind VARCHAR(24) NOT NULL,
    installation_id UUID NOT NULL,
    platform VARCHAR(16) NOT NULL,
    user_id UUID NOT NULL REFERENCES mypet.identity_account(id),
    role VARCHAR(32) NOT NULL,
    session_id UUID NOT NULL REFERENCES mypet.user_session(id),
    protected_token TEXT NOT NULL,
    token_fingerprint VARCHAR(32) NOT NULL,
    permission_state VARCHAR(24) NOT NULL,
    status VARCHAR(24) NOT NULL,
    last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_device_binding UNIQUE (environment, app_kind, installation_id, token_fingerprint)
);

CREATE TABLE mypet.notification_item (
    id UUID PRIMARY KEY,
    source_event_id UUID NOT NULL,
    recipient_id UUID NOT NULL REFERENCES mypet.identity_account(id),
    event_type VARCHAR(80) NOT NULL,
    template_version VARCHAR(80) NOT NULL,
    safe_route VARCHAR(120) NOT NULL,
    resource_id UUID NOT NULL,
    title VARCHAR(80) NOT NULL,
    body VARCHAR(240) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_notification_item UNIQUE (source_event_id, recipient_id, template_version)
);

CREATE TABLE mypet.notification_attempt (
    id UUID PRIMARY KEY,
    notification_id UUID NOT NULL REFERENCES mypet.notification_item(id),
    registration_id UUID NOT NULL REFERENCES mypet.device_registration(id),
    channel VARCHAR(24) NOT NULL,
    status VARCHAR(24) NOT NULL,
    provider_reference VARCHAR(160),
    safe_provider_code VARCHAR(80),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_notification_device_channel UNIQUE (notification_id, registration_id, channel),
    CHECK (attempt_count >= 0)
);

CREATE TABLE mypet.dead_letter (
    id UUID PRIMARY KEY,
    source_event_id UUID NOT NULL,
    consumer_name VARCHAR(80) NOT NULL,
    safe_error_code VARCHAR(80) NOT NULL,
    attempt_count INTEGER NOT NULL,
    payload TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP WITH TIME ZONE,
    CHECK (attempt_count > 0)
);

CREATE TABLE mypet.private_document (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES mypet.merchant_organization(id),
    outlet_id UUID NOT NULL REFERENCES mypet.provider_outlet(id),
    purpose VARCHAR(48) NOT NULL,
    object_key VARCHAR(320) NOT NULL UNIQUE,
    content_type VARCHAR(80) NOT NULL,
    size_bytes BIGINT NOT NULL,
    checksum VARCHAR(128) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (size_bytes > 0)
);

CREATE TABLE mypet.audit_event (
    id UUID PRIMARY KEY,
    actor_id UUID NOT NULL,
    actor_role VARCHAR(32) NOT NULL,
    action VARCHAR(80) NOT NULL,
    target_type VARCHAR(48) NOT NULL,
    target_id UUID NOT NULL,
    reason VARCHAR(240),
    source VARCHAR(48) NOT NULL,
    idempotency_key VARCHAR(128),
    trace_id VARCHAR(64) NOT NULL,
    occurred_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_listing_public_catalog ON mypet.catalog_listing(outlet_id, active, commerce_mode);
CREATE INDEX idx_inventory_movement_listing_time ON mypet.inventory_movement(listing_id, occurred_at);
CREATE INDEX idx_order_outlet_status_time ON mypet.product_order(outlet_id, status, created_at);
CREATE INDEX idx_order_customer_time ON mypet.product_order(customer_id, created_at);
CREATE INDEX idx_loyalty_customer_merchant ON mypet.loyalty_source(customer_id, organization_id, created_at);
CREATE INDEX idx_outbox_claim ON mypet.outbox_event(status, available_at, created_at);
CREATE INDEX idx_device_active_recipient ON mypet.device_registration(user_id, status, environment, app_kind);
CREATE INDEX idx_notification_recipient_time ON mypet.notification_item(recipient_id, created_at);
CREATE INDEX idx_audit_target_time ON mypet.audit_event(target_type, target_id, occurred_at);
