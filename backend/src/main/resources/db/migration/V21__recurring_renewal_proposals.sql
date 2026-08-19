ALTER TABLE mypet.recurring_order_subscription
    ADD COLUMN fulfilment_mode VARCHAR(32) NOT NULL DEFAULT 'STORE_PICKUP';

UPDATE mypet.recurring_order_subscription s
SET fulfilment_mode = o.fulfilment_mode
FROM mypet.product_order o
WHERE o.id = s.source_order_id;

ALTER TABLE mypet.recurring_order_subscription
    ADD COLUMN time_zone VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata';

ALTER TABLE mypet.recurring_order_subscription
    ADD COLUMN version BIGINT NOT NULL DEFAULT 0;

ALTER TABLE mypet.recurring_order_subscription
    ALTER COLUMN delivery_address_id DROP NOT NULL;

-- V20 used a subscription status as a read-side reminder flag. V21 moves reminder
-- state into a durable proposal aggregate; schedules themselves return to ACTIVE.
UPDATE mypet.recurring_order_subscription
SET status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP
WHERE status = 'AWAITING_CONFIRMATION';

CREATE TABLE mypet.recurring_order_proposal (
    id UUID PRIMARY KEY,
    subscription_id UUID NOT NULL REFERENCES mypet.recurring_order_subscription(id),
    customer_id UUID NOT NULL REFERENCES mypet.identity_account(id),
    provider_id UUID NOT NULL REFERENCES mypet.provider_outlet(id),
    source_order_id UUID NOT NULL REFERENCES mypet.product_order(id),
    delivery_address_id UUID NULL REFERENCES mypet.customer_address(id),
    fulfilment_mode VARCHAR(32) NOT NULL,
    cadence_days INTEGER NOT NULL,
    quantity_multiplier INTEGER NOT NULL,
    due_cycle_at TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(32) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    revalidated_at TIMESTAMP WITH TIME ZONE NULL,
    confirmed_at TIMESTAMP WITH TIME ZONE NULL,
    order_id UUID NULL REFERENCES mypet.product_order(id),
    checkout_idempotency_key VARCHAR(128) NULL,
    failure_reason VARCHAR(240) NULL,
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_recurring_proposal_cycle UNIQUE(subscription_id, due_cycle_at),
    CONSTRAINT ck_recurring_proposal_cadence CHECK (cadence_days IN (7, 15, 25, 30, 35)),
    CONSTRAINT ck_recurring_proposal_quantity CHECK (quantity_multiplier BETWEEN 1 AND 20),
    CONSTRAINT ck_recurring_proposal_mode CHECK (fulfilment_mode IN ('STORE_PICKUP', 'MYPET_CAPTAIN_DELIVERY')),
    CONSTRAINT ck_recurring_proposal_status CHECK (
        status IN ('DUE', 'REVALIDATION_FAILED', 'AWAITING_CONFIRMATION', 'CONFIRMED', 'ORDER_CREATED', 'EXPIRED', 'SKIPPED')
    )
);

CREATE INDEX idx_recurring_proposal_customer_created
    ON mypet.recurring_order_proposal(customer_id, created_at DESC, id DESC);

CREATE INDEX idx_recurring_proposal_expiry
    ON mypet.recurring_order_proposal(status, expires_at, id);

CREATE TABLE mypet.recurring_order_command (
    customer_id UUID NOT NULL REFERENCES mypet.identity_account(id),
    idempotency_key VARCHAR(128) NOT NULL,
    request_fingerprint VARCHAR(64) NOT NULL,
    command_type VARCHAR(48) NOT NULL,
    subscription_id UUID NOT NULL REFERENCES mypet.recurring_order_subscription(id),
    proposal_id UUID NULL REFERENCES mypet.recurring_order_proposal(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(customer_id, idempotency_key)
);

CREATE INDEX idx_recurring_command_subscription
    ON mypet.recurring_order_command(subscription_id, created_at DESC);

CREATE TABLE mypet.recurring_order_history (
    id UUID PRIMARY KEY,
    subscription_id UUID NOT NULL REFERENCES mypet.recurring_order_subscription(id),
    proposal_id UUID NULL REFERENCES mypet.recurring_order_proposal(id),
    event_type VARCHAR(48) NOT NULL,
    actor_id UUID NOT NULL,
    actor_role VARCHAR(24) NOT NULL,
    source VARCHAR(24) NOT NULL,
    idempotency_key VARCHAR(128) NOT NULL,
    trace_id VARCHAR(128) NOT NULL,
    details VARCHAR(1000) NULL,
    occurred_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_recurring_history_subscription
    ON mypet.recurring_order_history(subscription_id, occurred_at, id);
