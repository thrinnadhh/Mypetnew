CREATE TABLE IF NOT EXISTS mypet.service_region (
    id UUID PRIMARY KEY,
    city_identity VARCHAR(80) NOT NULL UNIQUE,
    display_name VARCHAR(120) NOT NULL,
    state_name VARCHAR(120) NOT NULL,
    country_name VARCHAR(120) NOT NULL,
    center_latitude NUMERIC(9, 6) NOT NULL,
    center_longitude NUMERIC(9, 6) NOT NULL,
    radius_km NUMERIC(7, 2) NOT NULL CHECK (radius_km > 0),
    status VARCHAR(20) NOT NULL CHECK (status IN ('ACTIVE', 'INACTIVE')),
    allow_products BOOLEAN NOT NULL DEFAULT TRUE,
    allow_grooming BOOLEAN NOT NULL DEFAULT TRUE,
    allow_vet BOOLEAN NOT NULL DEFAULT TRUE,
    allow_own_delivery BOOLEAN NOT NULL DEFAULT TRUE,
    allow_3p_delivery BOOLEAN NOT NULL DEFAULT TRUE,
    allow_cod BOOLEAN NOT NULL DEFAULT TRUE,
    allow_online_payment BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS mypet.service_region_pincode (
    service_region_id UUID NOT NULL REFERENCES mypet.service_region(id) ON DELETE CASCADE,
    pincode VARCHAR(6) NOT NULL CHECK (pincode ~ '^[0-9]{6}$'),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (service_region_id, pincode)
);

CREATE INDEX IF NOT EXISTS idx_service_region_pincode_lookup
    ON mypet.service_region_pincode (pincode, active);

CREATE TABLE IF NOT EXISTS mypet.service_region_launch_request (
    id UUID PRIMARY KEY,
    city_name VARCHAR(120) NOT NULL,
    city_name_normalized VARCHAR(120) NOT NULL,
    contact_info VARCHAR(254) NOT NULL,
    contact_normalized VARCHAR(254) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_service_region_launch_request UNIQUE (city_name_normalized, contact_normalized)
);

CREATE INDEX IF NOT EXISTS idx_service_region_launch_request_created
    ON mypet.service_region_launch_request (created_at DESC);

INSERT INTO mypet.service_region (
    id,
    city_identity,
    display_name,
    state_name,
    country_name,
    center_latitude,
    center_longitude,
    radius_km,
    status,
    allow_products,
    allow_grooming,
    allow_vet,
    allow_own_delivery,
    allow_3p_delivery,
    allow_cod,
    allow_online_payment
)
VALUES (
    '81111111-1111-1111-1111-111111111111',
    'tirupati',
    'Tirupati',
    'Andhra Pradesh',
    'India',
    13.628800,
    79.419200,
    25.00,
    'ACTIVE',
    TRUE,
    TRUE,
    TRUE,
    TRUE,
    TRUE,
    TRUE,
    TRUE
)
ON CONFLICT (id) DO UPDATE SET
    city_identity = EXCLUDED.city_identity,
    display_name = EXCLUDED.display_name,
    state_name = EXCLUDED.state_name,
    country_name = EXCLUDED.country_name,
    center_latitude = EXCLUDED.center_latitude,
    center_longitude = EXCLUDED.center_longitude,
    radius_km = EXCLUDED.radius_km,
    status = EXCLUDED.status,
    updated_at = CURRENT_TIMESTAMP;

INSERT INTO mypet.service_region_pincode (service_region_id, pincode, active)
VALUES
    ('81111111-1111-1111-1111-111111111111', '517501', TRUE),
    ('81111111-1111-1111-1111-111111111111', '517502', TRUE),
    ('81111111-1111-1111-1111-111111111111', '517507', TRUE)
ON CONFLICT (service_region_id, pincode) DO UPDATE SET active = EXCLUDED.active;
