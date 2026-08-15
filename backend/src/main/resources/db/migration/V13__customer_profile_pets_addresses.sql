CREATE TABLE mypet.customer_pet (
    id UUID PRIMARY KEY,
    customer_id UUID NOT NULL REFERENCES mypet.identity_account(id) ON DELETE CASCADE,
    name VARCHAR(80) NOT NULL,
    species VARCHAR(16) NOT NULL,
    breed VARCHAR(120),
    date_of_birth DATE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CHECK (LENGTH(name) BETWEEN 1 AND 80),
    CHECK (species IN ('DOG', 'CAT', 'OTHER')),
    CHECK (breed IS NULL OR LENGTH(breed) BETWEEN 1 AND 120)
);

CREATE INDEX idx_customer_pet_owner_created
    ON mypet.customer_pet(customer_id, created_at DESC, id DESC);

CREATE TABLE mypet.customer_address (
    id UUID PRIMARY KEY,
    customer_id UUID NOT NULL REFERENCES mypet.identity_account(id) ON DELETE CASCADE,
    label VARCHAR(40) NOT NULL,
    recipient_name VARCHAR(120) NOT NULL,
    phone_e164 VARCHAR(16) NOT NULL,
    line1 VARCHAR(240) NOT NULL,
    line2 VARCHAR(240),
    city VARCHAR(120) NOT NULL,
    state VARCHAR(120) NOT NULL,
    pincode VARCHAR(6) NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CHECK (LENGTH(label) BETWEEN 1 AND 40),
    CHECK (LENGTH(recipient_name) BETWEEN 1 AND 120),
    CHECK (LENGTH(phone_e164) BETWEEN 12 AND 13),
    CHECK (LENGTH(line1) BETWEEN 3 AND 240),
    CHECK (line2 IS NULL OR LENGTH(line2) BETWEEN 1 AND 240),
    CHECK (LENGTH(city) BETWEEN 2 AND 120),
    CHECK (LENGTH(state) BETWEEN 2 AND 120),
    CHECK (LENGTH(pincode) = 6)
);

CREATE INDEX idx_customer_address_owner_default
    ON mypet.customer_address(customer_id, is_default DESC, updated_at DESC, id DESC);
