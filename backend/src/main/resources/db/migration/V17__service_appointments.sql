CREATE TABLE mypet.service_offering (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES mypet.merchant_organization(id),
    outlet_id UUID NOT NULL REFERENCES mypet.provider_outlet(id),
    capability VARCHAR(32) NOT NULL,
    name VARCHAR(160) NOT NULL,
    description VARCHAR(1000),
    duration_minutes INTEGER NOT NULL,
    price_paise BIGINT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (capability IN ('GROOMING', 'VETERINARY')),
    CHECK (duration_minutes BETWEEN 5 AND 480),
    CHECK (price_paise BETWEEN 0 AND 10000000)
);

CREATE INDEX idx_service_offering_public
    ON mypet.service_offering(outlet_id, capability, active, name);

CREATE TABLE mypet.service_slot (
    id UUID PRIMARY KEY,
    service_id UUID NOT NULL REFERENCES mypet.service_offering(id),
    starts_at TIMESTAMP WITH TIME ZONE NOT NULL,
    ends_at TIMESTAMP WITH TIME ZONE NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_service_slot_start UNIQUE (service_id, starts_at),
    CHECK (ends_at > starts_at)
);

CREATE INDEX idx_service_slot_availability
    ON mypet.service_slot(service_id, active, starts_at);

CREATE TABLE mypet.appointment (
    id UUID PRIMARY KEY,
    customer_id UUID NOT NULL REFERENCES mypet.identity_account(id),
    pet_id UUID NOT NULL REFERENCES mypet.customer_pet(id),
    organization_id UUID NOT NULL REFERENCES mypet.merchant_organization(id),
    outlet_id UUID NOT NULL REFERENCES mypet.provider_outlet(id),
    service_id UUID NOT NULL REFERENCES mypet.service_offering(id),
    slot_id UUID NOT NULL REFERENCES mypet.service_slot(id),
    service_name VARCHAR(160) NOT NULL,
    outlet_name VARCHAR(160) NOT NULL,
    pet_name VARCHAR(80) NOT NULL,
    starts_at TIMESTAMP WITH TIME ZONE NOT NULL,
    ends_at TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(32) NOT NULL,
    payment_method VARCHAR(32) NOT NULL,
    payment_status VARCHAR(32) NOT NULL,
    price_paise BIGINT NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    notes VARCHAR(1000),
    hold_expires_at TIMESTAMP WITH TIME ZONE,
    idempotency_key VARCHAR(128) NOT NULL,
    request_fingerprint VARCHAR(64) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_appointment_customer_idempotency UNIQUE (customer_id, idempotency_key),
    CHECK (status IN ('HOLD','BOOKED','CONFIRMED','CHECKED_IN','IN_SERVICE','COMPLETED','HOLD_EXPIRED','REJECTED','CANCELLED','NO_SHOW')),
    CHECK (payment_method IN ('PAY_AT_PROVIDER')),
    CHECK (payment_status IN ('NOT_REQUIRED','PENDING')),
    CHECK (price_paise >= 0),
    CHECK (currency = 'INR'),
    CHECK (ends_at > starts_at)
);

-- Slot exclusivity is enforced transactionally by locking the service_slot row and
-- checking occupying appointment states before insert. Keep this ordinary index
-- portable across PostgreSQL and the H2 PostgreSQL-mode migration contract suite.
CREATE INDEX idx_appointment_slot_status
    ON mypet.appointment(slot_id, status);

CREATE INDEX idx_appointment_customer_list
    ON mypet.appointment(customer_id, starts_at DESC, id DESC);

CREATE TABLE mypet.appointment_history (
    id UUID PRIMARY KEY,
    appointment_id UUID NOT NULL REFERENCES mypet.appointment(id),
    status VARCHAR(32) NOT NULL,
    actor_id UUID NOT NULL,
    note VARCHAR(500),
    occurred_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (status IN ('HOLD','BOOKED','CONFIRMED','CHECKED_IN','IN_SERVICE','COMPLETED','HOLD_EXPIRED','REJECTED','CANCELLED','NO_SHOW'))
);

CREATE INDEX idx_appointment_history_timeline
    ON mypet.appointment_history(appointment_id, occurred_at, id);