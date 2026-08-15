CREATE TABLE mypet.service_offering (
    id UUID PRIMARY KEY,
    outlet_id UUID NOT NULL REFERENCES mypet.provider_outlet(id) ON DELETE CASCADE,
    name VARCHAR(160) NOT NULL,
    description VARCHAR(500),
    price_paise BIGINT NOT NULL,
    duration_minutes INTEGER NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (price_paise >= 0),
    CHECK (duration_minutes BETWEEN 5 AND 480),
    CHECK (status IN ('ACTIVE', 'INACTIVE'))
);

CREATE INDEX idx_service_offering_outlet_status
    ON mypet.service_offering(outlet_id, status, created_at DESC);

CREATE TABLE mypet.service_slot (
    id UUID PRIMARY KEY,
    offering_id UUID NOT NULL REFERENCES mypet.service_offering(id) ON DELETE CASCADE,
    slot_start TIMESTAMP WITH TIME ZONE NOT NULL,
    slot_end TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (slot_end > slot_start),
    CONSTRAINT uq_service_slot_offering_start UNIQUE (offering_id, slot_start)
);

CREATE INDEX idx_service_slot_offering_start
    ON mypet.service_slot(offering_id, slot_start);

CREATE TABLE mypet.appointment (
    id UUID PRIMARY KEY,
    customer_id UUID NOT NULL REFERENCES mypet.identity_account(id) ON DELETE RESTRICT,
    provider_id UUID NOT NULL REFERENCES mypet.provider_outlet(id) ON DELETE RESTRICT,
    offering_id UUID NOT NULL REFERENCES mypet.service_offering(id) ON DELETE RESTRICT,
    slot_id UUID NOT NULL REFERENCES mypet.service_slot(id) ON DELETE RESTRICT,
    pet_id UUID NOT NULL REFERENCES mypet.customer_pet(id) ON DELETE RESTRICT,
    price_paise BIGINT NOT NULL,
    status VARCHAR(32) NOT NULL,
    pay_at_clinic BOOLEAN NOT NULL DEFAULT TRUE,
    payment_id UUID,
    hold_expires_at TIMESTAMP WITH TIME ZONE,
    booked_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (price_paise >= 0),
    CHECK (status IN ('HOLD', 'HOLD_EXPIRED', 'BOOKED', 'CONFIRMED', 'CHECKED_IN', 'IN_SERVICE', 'COMPLETED', 'CANCELLED', 'REJECTED', 'NO_SHOW'))
);

CREATE UNIQUE INDEX uq_appointment_active_slot
    ON mypet.appointment(slot_id)
    WHERE status IN ('HOLD', 'BOOKED', 'CONFIRMED', 'CHECKED_IN', 'IN_SERVICE');

CREATE INDEX idx_appointment_customer_created
    ON mypet.appointment(customer_id, created_at DESC, id DESC);

CREATE TABLE mypet.appointment_history (
    id UUID PRIMARY KEY,
    appointment_id UUID NOT NULL REFERENCES mypet.appointment(id) ON DELETE CASCADE,
    from_status VARCHAR(32),
    to_status VARCHAR(32) NOT NULL,
    actor_id UUID NOT NULL,
    reason VARCHAR(240),
    occurred_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_appointment_history_appointment_time
    ON mypet.appointment_history(appointment_id, occurred_at, id);
