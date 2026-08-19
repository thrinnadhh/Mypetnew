CREATE TABLE mypet.recurring_order_subscription (
    id UUID PRIMARY KEY,
    customer_id UUID NOT NULL REFERENCES mypet.identity_account(id) ON DELETE CASCADE,
    provider_id UUID NOT NULL REFERENCES mypet.provider_outlet(id),
    source_order_id UUID NOT NULL REFERENCES mypet.product_order(id),
    delivery_address_id UUID NOT NULL REFERENCES mypet.customer_address(id),
    cadence_days INTEGER NOT NULL,
    quantity_multiplier INTEGER NOT NULL,
    status VARCHAR(32) NOT NULL,
    next_order_at TIMESTAMP WITH TIME ZONE NOT NULL,
    last_reminded_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CHECK (cadence_days IN (7, 15, 25, 30, 35)),
    CHECK (quantity_multiplier BETWEEN 1 AND 20),
    CHECK (status IN ('ACTIVE', 'PAUSED', 'AWAITING_CONFIRMATION', 'CANCELLED'))
);

CREATE INDEX idx_recurring_order_customer_created
    ON mypet.recurring_order_subscription(customer_id, created_at DESC, id DESC);

CREATE INDEX idx_recurring_order_due
    ON mypet.recurring_order_subscription(status, next_order_at);

CREATE UNIQUE INDEX uq_recurring_order_active_source
    ON mypet.recurring_order_subscription(customer_id, source_order_id)
    WHERE status <> 'CANCELLED';
